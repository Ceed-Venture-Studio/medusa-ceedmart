import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../modules/preorder"
import { TERMS_SLUGS } from "../../../../modules/terms"
import {
  deliversTo,
  estimateBreakdown,
  estimatedDeliveryDate,
  isOfferSellable,
} from "../../../../lib/preorder/estimate"
import { inclusionSummary } from "../../../../lib/preorder/pricing"
import { getCurrentVersion } from "../../../../lib/terms"
import { FEATURE_FLAGS, assertEnabled } from "../../../../lib/feature-flags"

// Public pre-order offer detail (BRD §6.3, §6.4).
//
// Everything the product page must show before a customer commits: the
// delivery estimate for THEIR location, what the price covers, the item's
// condition, the warranty, and the terms they will be asked to accept.
//
// The cost BREAKDOWN is never exposed — §5.3 keeps source cost and FX
// internal. Only the single all-inclusive naira figure and a plain-language
// statement of what it includes go out.
//
// Availability freshness is enforced here as well as in the cart, so a
// stale offer stops advertising a delivery date it cannot honour.
const MAX_VERIFICATION_AGE_DAYS = Number(
  process.env.PREORDER_MAX_VERIFICATION_AGE_DAYS || 7
)

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.PREORDER)

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const offer = await svc.retrievePreorderOffer(req.params.id).catch(() => null)

  if (!offer || !offer.is_active) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order offer with id: ${req.params.id} was not found`
    )
  }

  const state =
    typeof req.query.state === "string" ? req.query.state.trim() : null

  const sellable = isOfferSellable(offer, {
    maxVerificationAgeDays: MAX_VERIFICATION_AGE_DAYS,
  })
  const covered = deliversTo(offer.delivery_states, state)

  const breakdown = estimateBreakdown(offer)
  const inclusions = inclusionSummary(offer)

  // The terms the customer will be asked to accept. Surfaced on the product
  // page rather than sprung at checkout, since §6.4 requires cancellation
  // terms be visible before the item is added to a cart.
  const terms = await getCurrentVersion(req.scope, TERMS_SLUGS.PREORDER)

  res.json({
    preorder: {
      id: offer.id,
      product_id: offer.product_id,
      variant_id: offer.variant_id,

      price: Number(offer.locked_price),
      currency_code: offer.currency_code,
      // §6.4 — the checkout must disclose whether the paid total is final.
      // Under D-02 it always is.
      price_is_final: true,

      estimate_days: breakdown.totalDays,
      estimated_delivery_date: estimatedDeliveryDate(offer).toISOString(),
      // Legs are shown so "two weeks" is explicable rather than asserted.
      estimate_breakdown: {
        procurement_days: breakdown.procurementDays,
        transit_days: breakdown.transitDays,
        customs_days: breakdown.customsDays,
      },

      includes: inclusions.included,
      excludes: inclusions.excluded,

      source_country_code: offer.source_country_code,
      condition: offer.condition,
      condition_notes: offer.condition_notes,
      warranty_text: offer.warranty_text,
      warranty_provider: offer.warranty_provider,
      return_policy_text: offer.return_policy_text,

      max_per_order: offer.max_per_order,
      offer_expires_at: offer.offer_expires_at,

      delivers_to_state: covered,
      delivery_states: offer.delivery_states ?? [],

      available: sellable.sellable && covered,
      unavailable_reason: !sellable.sellable
        ? sellable.reason
        : !covered
          ? "This item doesn't ship to your state yet."
          : null,

      terms: terms
        ? { version_id: terms.id, version: terms.version, body: terms.body }
        : null,
    },
  })
}
