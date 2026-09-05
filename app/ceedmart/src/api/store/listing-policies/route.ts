import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  COMMERCE_TYPE_LABEL,
  resolvePoliciesForVariants,
} from "../../../lib/listing-policy"

// Batch commerce-type lookup for the storefront (BRD §5.1).
//
// The storefront caches product responses aggressively with tag-based
// revalidation, so folding commerce type into the product payload would mean
// a policy change waiting on a product cache bust. This endpoint is queried
// separately and cached on its own short window, which keeps a listing
// flipping to "auction" from being served as ordinary stock for an hour.
//
// Takes variant ids paired with their product ids, because product-level
// policies apply to variants that have none of their own.

const MAX_TARGETS = 100

type Target = { variant_id: string; product_id: string }

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const raw = req.query.targets

  let targets: Target[] = []
  if (typeof raw === "string" && raw.trim()) {
    // Compact "variant:product,variant:product" form keeps the querystring
    // short enough to stay cacheable.
    targets = raw
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [variant_id, product_id] = pair.split(":")
        return { variant_id, product_id }
      })
      .filter((t) => t.variant_id && t.product_id)
  }

  if (!targets.length) {
    res.json({ policies: {} })
    return
  }

  if (targets.length > MAX_TARGETS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `At most ${MAX_TARGETS} targets per request, received ${targets.length}`
    )
  }

  const resolved = await resolvePoliciesForVariants(
    req.scope,
    targets.map((t) => ({ variantId: t.variant_id, productId: t.product_id }))
  )

  const policies: Record<string, unknown> = {}
  for (const [variantId, policy] of resolved) {
    // Standard listings are the overwhelming majority — omit them so the
    // response stays small and the client can treat "absent" as standard.
    if (policy.commerceType === "standard" && policy.isActive) continue
    policies[variantId] = {
      commerce_type: policy.commerceType,
      is_active: policy.isActive,
      label: COMMERCE_TYPE_LABEL[policy.commerceType],
      reference_id: policy.referenceId,
      config: policy.config,
    }
  }

  res.json({ policies })
}
