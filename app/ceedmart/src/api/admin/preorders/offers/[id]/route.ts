import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../../modules/preorder"
import { estimateBreakdown } from "../../../../../lib/preorder/estimate"
import {
  computeLandedCost,
  marginOn,
  priceDrift,
} from "../../../../../lib/preorder/pricing"
import {
  removeOfferPolicy,
  syncOfferPolicy,
} from "../../../../../lib/preorder/sync-policy"
import { actorFromRequest } from "../../../../../lib/state-machine"
import { preorderMachine } from "../../../../../lib/state-machine/machines"

// Update, publish and retire a single pre-order offer.

const EDITABLE = new Set([
  "supplier_id",
  "source_country_code",
  "locked_price",
  "cost_components",
  "fx_rate",
  "includes_duty",
  "includes_clearing",
  "includes_local_delivery",
  "procurement_days",
  "transit_days",
  "customs_days",
  "total_days_override",
  "delivery_states",
  "condition",
  "condition_notes",
  "warranty_text",
  "warranty_provider",
  "return_policy_text",
  "offer_expires_at",
  "max_per_order",
  "max_per_customer",
  "is_active",
  "availability_verified",
])

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const offer = await svc.retrievePreorderOffer(req.params.id).catch(() => null)

  if (!offer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order offer with id: ${req.params.id} was not found`
    )
  }

  res.json({
    offer: {
      ...offer,
      estimate: estimateBreakdown(offer),
      landed_cost: computeLandedCost(offer.cost_components ?? {}),
      margin: marginOn(Number(offer.locked_price), offer.cost_components ?? {}),
      drift: priceDrift(Number(offer.locked_price), offer.cost_components ?? {}),
    },
  })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<Record<string, any>>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body ?? {}

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const existing = await svc.retrievePreorderOffer(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order offer with id: ${id} was not found`
    )
  }

  const update: Record<string, any> = { id }
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) continue
    if (key === "availability_verified") continue
    update[key] = value
  }

  if ("locked_price" in update) {
    const price = Number(update.locked_price)
    if (!Number.isFinite(price) || price <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "locked_price must be a positive amount in kobo"
      )
    }
  }

  if ("offer_expires_at" in update && update.offer_expires_at) {
    update.offer_expires_at = new Date(update.offer_expires_at)
  }

  // Re-locking the price re-stamps the FX capture time, so "when was this
  // priced" is always answerable.
  if ("fx_rate" in update) {
    update.fx_captured_at = new Date()
  }

  // Explicit availability confirmation. Separate from the rest because it is
  // an assertion about the outside world, not an edit — §6.5 puts an order
  // into the exception queue when availability cannot be confirmed, and this
  // is the check that keeps that rare.
  if (body.availability_verified === true) {
    update.availability_verified_at = new Date()
  }

  // Publishing requires a confirmed availability check. Without it we would
  // be taking money for an item nobody has looked for.
  const activating = update.is_active === true && existing.is_active !== true
  if (activating) {
    const verifiedAt =
      update.availability_verified_at ?? existing.availability_verified_at
    if (!verifiedAt) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Confirm availability before publishing this offer — send availability_verified: true"
      )
    }
  }

  const updated = await svc.updatePreorderOffers(update)
  const offer = Array.isArray(updated) ? updated[0] : updated

  await syncOfferPolicy(req.scope, offer)

  const changed = Object.keys(update).filter((k) => k !== "id")
  await preorderMachine.record(req.scope, {
    entityId: id,
    action: activating
      ? "offer.published"
      : update.is_active === false && existing.is_active === true
        ? "offer.unpublished"
        : "offer.updated",
    actor: actorFromRequest(req),
    changes: {
      fields: changed,
      previous_price: existing.locked_price,
      new_price: offer.locked_price,
    },
  })

  res.json({ offer: { ...offer, estimate: estimateBreakdown(offer) } })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(PREORDER_MODULE)

  const existing = await svc.retrievePreorderOffer(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order offer with id: ${id} was not found`
    )
  }

  // An offer with live pre-orders against it is history, not a draft.
  // Deleting it would orphan those records' reference to what was sold.
  const live = await svc.listPreorderOrders({ offer_id: id }, { take: 1 })
  if (live?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This offer has pre-orders against it. Unpublish it instead of deleting."
    )
  }

  await removeOfferPolicy(req.scope, existing)
  await svc.deletePreorderOffers(id)

  await preorderMachine.record(req.scope, {
    entityId: id,
    action: "offer.deleted",
    actor: actorFromRequest(req),
  })

  res.json({ id, object: "preorder_offer", deleted: true })
}
