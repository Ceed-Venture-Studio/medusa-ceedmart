import {
  cartRejectionReason,
  isCartEligible,
  resolvePoliciesForVariants,
  resolvePolicyForVariant,
  STANDARD_POLICY,
} from "."

// Container stub returning canned listing_policy rows.
const makeContainer = (rows: any[]) => ({
  resolve: (key: string) => {
    if (key !== "listing_policy") throw new Error(`unexpected resolve(${key})`)
    return {
      listListingPolicies: async (filters: any) => {
        if (filters.variant_id) {
          const ids: string[] = ([] as string[]).concat(filters.variant_id)
          return rows.filter((r) => r.variant_id && ids.includes(r.variant_id))
        }
        if (filters.product_id) {
          const ids: string[] = ([] as string[]).concat(filters.product_id)
          return rows.filter((r) => r.product_id && ids.includes(r.product_id))
        }
        return []
      },
    }
  },
})

describe("commerce-type resolution", () => {
  it("defaults to standard when no policy row exists", async () => {
    const container = makeContainer([]) as any

    const policy = await resolvePolicyForVariant(container, {
      variantId: "var_1",
      productId: "prod_1",
    })

    expect(policy).toEqual(STANDARD_POLICY)
  })

  it("applies a product policy to all of its variants", async () => {
    const container = makeContainer([
      { product_id: "prod_1", commerce_type: "preorder", is_active: true },
    ]) as any

    const map = await resolvePoliciesForVariants(container, [
      { variantId: "var_1", productId: "prod_1" },
      { variantId: "var_2", productId: "prod_1" },
    ])

    expect(map.get("var_1")?.commerceType).toBe("preorder")
    expect(map.get("var_2")?.commerceType).toBe("preorder")
  })

  it("lets a variant policy beat its product policy", async () => {
    const container = makeContainer([
      { product_id: "prod_1", commerce_type: "standard", is_active: true },
      {
        variant_id: "var_2",
        commerce_type: "preorder",
        is_active: true,
        reference_id: "pre_9",
      },
    ]) as any

    const map = await resolvePoliciesForVariants(container, [
      { variantId: "var_1", productId: "prod_1" },
      { variantId: "var_2", productId: "prod_1" },
    ])

    expect(map.get("var_1")?.commerceType).toBe("standard")
    expect(map.get("var_2")?.commerceType).toBe("preorder")
    expect(map.get("var_2")?.referenceId).toBe("pre_9")
  })

  it("returns an entry for every requested variant", async () => {
    const container = makeContainer([]) as any

    const map = await resolvePoliciesForVariants(container, [
      { variantId: "var_1", productId: "prod_1" },
      { variantId: "var_2", productId: "prod_2" },
    ])

    expect(map.size).toBe(2)
  })
})

describe("cart eligibility", () => {
  const policy = (over: Partial<typeof STANDARD_POLICY>) => ({
    ...STANDARD_POLICY,
    ...over,
  })

  it("admits standard stock", () => {
    expect(isCartEligible(policy({ commerceType: "standard" }))).toBe(true)
  })

  it("admits US pre-orders — they share the cart with local stock", () => {
    expect(isCartEligible(policy({ commerceType: "preorder" }))).toBe(true)
  })

  it("keeps auction items out of the ordinary cart", () => {
    const p = policy({ commerceType: "auction" })
    expect(isCartEligible(p)).toBe(false)
    expect(cartRejectionReason(p)).toMatch(/placing a bid/)
  })

  it("keeps custom builds out until a quote is accepted", () => {
    const p = policy({ commerceType: "custom_build" })
    expect(isCartEligible(p)).toBe(false)
    expect(cartRejectionReason(p)).toMatch(/accepting a quote/)
  })

  it("rejects an inactive listing whatever its type", () => {
    const p = policy({ commerceType: "preorder", isActive: false })
    expect(isCartEligible(p)).toBe(false)
    expect(cartRejectionReason(p)).toMatch(/no longer available/)
  })

  it("gives no rejection reason for an eligible item", () => {
    expect(cartRejectionReason(policy({ commerceType: "standard" }))).toBeNull()
  })
})
