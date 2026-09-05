import type { MedusaContainer } from "@medusajs/framework/types"
import { LISTING_POLICY_MODULE } from "../../modules/listing-policy"
import { estimateDays } from "./estimate"

// Keep listing_policy in step with a pre-order offer.
//
// The cart asks listing_policy — and only listing_policy — what kind of
// listing something is. If an offer existed without a matching policy row,
// a pre-order item would be sold as ordinary stock: no badge, no terms, no
// pre-order record, and a customer expecting two-day delivery on something
// being flown in from Texas.
//
// So every write to an offer syncs its policy, and deactivating an offer
// deactivates the policy with it. The small denormalised `config` payload
// lets product cards render a badge and lead time without joining to the
// preorder module on every catalogue read.

export const syncOfferPolicy = async (
  container: MedusaContainer,
  offer: any
): Promise<void> => {
  const policies: any = container.resolve(LISTING_POLICY_MODULE)

  const target = offer.variant_id
    ? { variant_id: offer.variant_id }
    : { product_id: offer.product_id }

  const config = {
    estimate_days: estimateDays(offer),
    condition: offer.condition ?? "new",
    source_country_code: offer.source_country_code ?? "us",
    includes_duty: offer.includes_duty !== false,
    includes_clearing: offer.includes_clearing !== false,
    includes_local_delivery: offer.includes_local_delivery !== false,
    offer_expires_at: offer.offer_expires_at ?? null,
  }

  const [existing] = await policies.listListingPolicies(target, { take: 1 })

  if (existing) {
    await policies.updateListingPolicies({
      id: existing.id,
      commerce_type: "preorder",
      is_active: offer.is_active === true,
      reference_id: offer.id,
      config,
    })
    return
  }

  await policies.createListingPolicies({
    ...target,
    commerce_type: "preorder",
    is_active: offer.is_active === true,
    reference_id: offer.id,
    config,
  })
}

/**
 * Return a listing to ordinary stock when its offer is deleted.
 *
 * Deleting the policy outright rather than flipping it to "standard": an
 * absent policy already means standard, and leaving a dead row behind makes
 * the table lie about which listings have deliberate policies.
 */
export const removeOfferPolicy = async (
  container: MedusaContainer,
  offer: any
): Promise<void> => {
  const policies: any = container.resolve(LISTING_POLICY_MODULE)

  const target = offer.variant_id
    ? { variant_id: offer.variant_id }
    : { product_id: offer.product_id }

  const [existing] = await policies.listListingPolicies(target, { take: 1 })
  if (!existing) return
  if (existing.reference_id !== offer.id) return

  await policies.deleteListingPolicies(existing.id)
}
