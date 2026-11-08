import { PROVINCE_ATTRIBUTE } from "../locations"

// Pure rules for location pricing and availability. No container, so the
// precedence and the price sync plan are unit-tested in isolation; the
// workflows, hooks and routes only fetch rows and apply what these return.
//
// Precedence, for both prices and availability:
//
//   variant row  >  product row  >  national (price) / available

export type CatalogTarget = { variantId: string; productId: string }

export type AvailabilityRow = {
  product_id?: string | null
  variant_id?: string | null
  province: string
  is_available: boolean
}

export type LocationPriceRow = {
  product_id?: string | null
  variant_id?: string | null
  province: string
  currency_code: string
  amount: number | string
}

/** Variant id → whether it may be bought in `province`. */
export const resolveAvailability = (
  targets: CatalogTarget[],
  rows: AvailabilityRow[],
  province: string
): Map<string, boolean> => {
  const byVariant = new Map<string, boolean>()
  const byProduct = new Map<string, boolean>()
  for (const row of rows) {
    if (row.province !== province) continue
    if (row.variant_id) byVariant.set(row.variant_id, row.is_available)
    else if (row.product_id) byProduct.set(row.product_id, row.is_available)
  }

  const result = new Map<string, boolean>()
  for (const t of targets) {
    result.set(
      t.variantId,
      byVariant.get(t.variantId) ?? byProduct.get(t.productId) ?? true
    )
  }
  return result
}

/** Customer-facing reason a variant cannot be bought in a state. */
export const unavailableReason = (stateName: string | null): string =>
  stateName
    ? `This item is not available in ${stateName}.`
    : "This item is not available in your location."

// ── Price sync plan ─────────────────────────────────────────────────────

export type ExistingPrice = {
  id: string
  amount: number | string
  currency_code: string
  price_list_id?: string | null
  price_rules?: { attribute: string; value: string }[] | null
}

export type VariantPricing = {
  id: string
  price_set_id: string
  prices: ExistingPrice[]
}

export type PriceToCreate = {
  price_set_id: string
  currency_code: string
  amount: number
  rules: Record<string, string>
}

export type PriceSyncPlan = {
  create: PriceToCreate[]
  remove: string[]
}

const ruleOf = (p: ExistingPrice, attribute: string) =>
  p.price_rules?.find((r) => r.attribute === attribute)?.value

/**
 * A price this feature owns: a base price (not in a price list) carrying a
 * province rule. Everything else on the price set — national prices, sale
 * prices, anything another feature added — is never touched.
 */
export const isLocationPrice = (p: ExistingPrice): boolean =>
  !p.price_list_id && !!ruleOf(p, PROVINCE_ATTRIBUTE)

const keyOf = (
  province: string,
  currency: string,
  regionId: string | undefined
) => `${province}|${currency.toLowerCase()}|${regionId ?? ""}`

/**
 * The prices each variant's price set should carry for its location
 * prices, as creates and removals against what it carries now.
 *
 * ── Why the region rule is copied ───────────────────────────────────────
 * Medusa picks the matching price with the most rules, then the lowest
 * amount. Ceedmart's national prices carry a `region_id` rule, so a
 * province-only price would tie with them on rule count and lose whenever
 * the state is dearer. Each location price therefore carries the region
 * rule of every region in its currency as well as `province` — one more
 * rule than the national price, so it wins exactly where it matches.
 *
 * Changing an amount is a removal plus a create: prices are cheap rows and
 * this keeps the plan a pure set difference.
 */
export const planLocationPriceSync = (
  variants: (VariantPricing & { product_id: string })[],
  rows: LocationPriceRow[],
  regionIdsByCurrency: Record<string, string[]>
): PriceSyncPlan => {
  const plan: PriceSyncPlan = { create: [], remove: [] }

  for (const variant of variants) {
    // Effective amount per (province, currency): variant row over product row.
    const effective = new Map<string, LocationPriceRow>()
    for (const row of rows) {
      if (row.product_id !== variant.product_id || row.variant_id) continue
      effective.set(`${row.province}|${row.currency_code.toLowerCase()}`, row)
    }
    for (const row of rows) {
      if (row.variant_id !== variant.id) continue
      effective.set(`${row.province}|${row.currency_code.toLowerCase()}`, row)
    }

    const desired = new Map<string, PriceToCreate>()
    for (const row of effective.values()) {
      const currency = row.currency_code.toLowerCase()
      const regions = regionIdsByCurrency[currency] ?? []
      const regionChoices = regions.length ? regions : [undefined]
      for (const regionId of regionChoices) {
        const rules: Record<string, string> = {
          [PROVINCE_ATTRIBUTE]: row.province,
        }
        if (regionId) rules.region_id = regionId
        desired.set(keyOf(row.province, currency, regionId), {
          price_set_id: variant.price_set_id,
          currency_code: currency,
          amount: Number(row.amount),
          rules,
        })
      }
    }

    const kept = new Set<string>()
    for (const price of variant.prices.filter(isLocationPrice)) {
      const key = keyOf(
        ruleOf(price, PROVINCE_ATTRIBUTE)!,
        price.currency_code,
        ruleOf(price, "region_id")
      )
      const want = desired.get(key)
      // Kept only when it is exactly what would be created: same amount and
      // same rule set. Anything else (a stale amount, a duplicate, an extra
      // rule) is replaced, so the price set converges on the authoring rows.
      const ruleCount = price.price_rules?.length ?? 0
      const expectedRules = want ? Object.keys(want.rules).length : -1
      if (
        want &&
        !kept.has(key) &&
        ruleCount === expectedRules &&
        Number(price.amount) === want.amount
      ) {
        kept.add(key)
      } else {
        plan.remove.push(price.id)
      }
    }

    for (const [key, price] of desired) {
      if (!kept.has(key)) plan.create.push(price)
    }
  }

  return plan
}
