import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../modules/preorder"
import { estimateBreakdown } from "../../../../lib/preorder/estimate"
import { computeLandedCost, marginOn, priceDrift } from "../../../../lib/preorder/pricing"
import { syncOfferPolicy } from "../../../../lib/preorder/sync-policy"
import { actorFromRequest } from "../../../../lib/state-machine"
import { preorderMachine } from "../../../../lib/state-machine/machines"

// Admin CRUD for US pre-order offers (BRD §6.4, P1-2).
//
// Only authorised staff can publish these (§6.5) — the /admin namespace is
// already authenticated, so that is satisfied by placement.

type OfferBody = {
  product_id?: string
  variant_id?: string
  supplier_id?: string
  source_country_code?: string
  locked_price: number
  currency_code?: string
  cost_components?: Record<string, number>
  fx_rate?: number
  includes_duty?: boolean
  includes_clearing?: boolean
  includes_local_delivery?: boolean
  procurement_days?: number
  transit_days?: number
  customs_days?: number
  total_days_override?: number | null
  delivery_states?: string[]
  condition?: string
  condition_notes?: string
  warranty_text?: string
  warranty_provider?: string
  return_policy_text?: string
  offer_expires_at?: string
  max_per_order?: number
  max_per_customer?: number
  is_active?: boolean
}

const CONDITIONS = new Set(["new", "open_box", "refurbished", "used"])

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(PREORDER_MODULE)

  const filters: Record<string, unknown> = {}
  if (typeof req.query.is_active === "string") {
    filters.is_active = req.query.is_active === "true"
  }
  if (typeof req.query.supplier_id === "string") {
    filters.supplier_id = req.query.supplier_id
  }

  const offers = await svc.listPreorderOffers(filters, {
    order: { created_at: "DESC" },
    take: Number(req.query.limit) || 50,
    skip: Number(req.query.offset) || 0,
  })

  // Decorate with the derived numbers admin actually needs to make a
  // decision: the delivery window each offer promises, and whether its
  // locked price has drifted from its components since it was set.
  const decorated = (offers as any[]).map((offer) => ({
    ...offer,
    estimate: estimateBreakdown(offer),
    landed_cost: computeLandedCost(offer.cost_components ?? {}),
    margin: marginOn(Number(offer.locked_price), offer.cost_components ?? {}),
    drift: priceDrift(Number(offer.locked_price), offer.cost_components ?? {}),
  }))

  res.json({ offers: decorated })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<OfferBody>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as OfferBody)

  if (!body.product_id && !body.variant_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either product_id or variant_id is required"
    )
  }
  if (body.product_id && body.variant_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Provide product_id or variant_id, not both"
    )
  }

  const price = Number(body.locked_price)
  if (!Number.isFinite(price) || price <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "locked_price must be a positive amount in kobo"
    )
  }

  if (body.condition && !CONDITIONS.has(body.condition)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `condition must be one of ${[...CONDITIONS].join(", ")}`
    )
  }

  // Publishing an offer with no availability check is how a pre-order fails
  // after the customer has paid, so activation requires an explicit check.
  const svc: any = req.scope.resolve(PREORDER_MODULE)

  const offer = await svc.createPreorderOffers({
    product_id: body.product_id ?? null,
    variant_id: body.variant_id ?? null,
    supplier_id: body.supplier_id ?? null,
    source_country_code: body.source_country_code ?? "us",
    locked_price: price,
    currency_code: body.currency_code ?? "ngn",
    cost_components: body.cost_components ?? null,
    fx_rate: body.fx_rate ?? null,
    fx_captured_at: body.fx_rate ? new Date() : null,
    includes_duty: body.includes_duty !== false,
    includes_clearing: body.includes_clearing !== false,
    includes_local_delivery: body.includes_local_delivery !== false,
    procurement_days: body.procurement_days ?? 3,
    transit_days: body.transit_days ?? 7,
    customs_days: body.customs_days ?? 4,
    total_days_override: body.total_days_override ?? null,
    delivery_states: body.delivery_states ?? null,
    condition: body.condition ?? "new",
    condition_notes: body.condition_notes ?? null,
    warranty_text: body.warranty_text ?? null,
    warranty_provider: body.warranty_provider ?? null,
    return_policy_text: body.return_policy_text ?? null,
    offer_expires_at: body.offer_expires_at
      ? new Date(body.offer_expires_at)
      : null,
    max_per_order: body.max_per_order ?? null,
    max_per_customer: body.max_per_customer ?? null,
    // Never live on creation — an offer is published deliberately, after
    // someone has confirmed availability.
    is_active: false,
  })

  await syncOfferPolicy(req.scope, offer)

  await preorderMachine.record(req.scope, {
    entityId: offer.id,
    action: "offer.created",
    actor: actorFromRequest(req),
    metadata: { locked_price: price, currency: offer.currency_code },
  })

  res.status(201).json({
    offer: { ...offer, estimate: estimateBreakdown(offer) },
  })
}
