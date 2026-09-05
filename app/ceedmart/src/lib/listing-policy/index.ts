import type { MedusaContainer } from "@medusajs/framework/types"
import { LISTING_POLICY_MODULE } from "../../modules/listing-policy"
import type { CommerceType } from "../order-categorization/types"

// Commerce-type resolution (BRD §5.1).
//
// Every read goes through here so the precedence rule lives in one place:
//
//   variant policy  >  product policy  >  "standard"
//
// A product can be ordinary stock while one variant is a US pre-order, and
// a listing with no policy row at all is standard — so existing catalogue
// needs no backfill and the default is the safe one.

export const DEFAULT_COMMERCE_TYPE: CommerceType = "standard"

export type ResolvedPolicy = {
  commerceType: CommerceType
  isActive: boolean
  /** Points at the owning PreorderOffer / Auction row, when there is one. */
  referenceId: string | null
  config: Record<string, unknown> | null
}

export const STANDARD_POLICY: ResolvedPolicy = {
  commerceType: "standard",
  isActive: true,
  referenceId: null,
  config: null,
}

/** Commerce types that may not go through the ordinary cart (BRD §5.1). */
const CART_BLOCKED: readonly CommerceType[] = ["auction", "custom_build"]

/**
 * Resolve policies for a set of variants in one query pair.
 *
 * Returns a map keyed by variant id. Callers pass the variant's product id
 * so a product-level policy can apply where the variant has none.
 */
export const resolvePoliciesForVariants = async (
  container: MedusaContainer,
  targets: { variantId: string; productId: string }[]
): Promise<Map<string, ResolvedPolicy>> => {
  const result = new Map<string, ResolvedPolicy>()
  if (!targets.length) return result

  const service: any = container.resolve(LISTING_POLICY_MODULE)

  const variantIds = [...new Set(targets.map((t) => t.variantId))]
  const productIds = [...new Set(targets.map((t) => t.productId))]

  const [variantRows, productRows] = await Promise.all([
    service.listListingPolicies({ variant_id: variantIds }),
    service.listListingPolicies({ product_id: productIds }),
  ])

  const byVariant = new Map<string, any>(
    (variantRows as any[]).map((r) => [r.variant_id, r])
  )
  const byProduct = new Map<string, any>(
    (productRows as any[]).map((r) => [r.product_id, r])
  )

  for (const target of targets) {
    const row =
      byVariant.get(target.variantId) ?? byProduct.get(target.productId)
    result.set(target.variantId, row ? toResolved(row) : STANDARD_POLICY)
  }

  return result
}

/** Single-variant convenience wrapper. */
export const resolvePolicyForVariant = async (
  container: MedusaContainer,
  target: { variantId: string; productId: string }
): Promise<ResolvedPolicy> => {
  const map = await resolvePoliciesForVariants(container, [target])
  return map.get(target.variantId) ?? STANDARD_POLICY
}

const toResolved = (row: any): ResolvedPolicy => ({
  commerceType: (row.commerce_type ?? DEFAULT_COMMERCE_TYPE) as CommerceType,
  isActive: row.is_active !== false,
  referenceId: row.reference_id ?? null,
  config: (row.config ?? null) as Record<string, unknown> | null,
})

/**
 * Whether an item of this type may be added to the ordinary cart.
 *
 * §5.1 — an auction item must not be purchased through the normal cart
 * during an active auction, and a custom build must not enter the cart until
 * a quote is accepted and converted into a payable order. Pre-orders may,
 * provided their terms stay visible through checkout.
 */
export const isCartEligible = (policy: ResolvedPolicy): boolean => {
  if (!policy.isActive) return false
  return !CART_BLOCKED.includes(policy.commerceType)
}

/** Customer-facing reason an item cannot be added, for the cart error. */
export const cartRejectionReason = (policy: ResolvedPolicy): string | null => {
  if (isCartEligible(policy)) return null
  if (!policy.isActive) {
    return "This item is no longer available."
  }
  if (policy.commerceType === "auction") {
    return "Auction items are bought by placing a bid, not through the cart."
  }
  if (policy.commerceType === "custom_build") {
    return "Custom builds are ordered by accepting a quote, not through the cart."
  }
  return "This item cannot be added to the cart."
}

/** Short badge label per commerce type, for product cards and cart lines. */
export const COMMERCE_TYPE_LABEL: Record<CommerceType, string> = {
  standard: "In stock",
  preorder: "Ships from the US",
  custom_build: "Custom build",
  auction: "Auction",
}
