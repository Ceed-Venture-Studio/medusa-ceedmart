// Landed-cost composition for US pre-orders (BRD §6.4, D-02).
//
// ── The model ───────────────────────────────────────────────────────────
// D-02 is "locked all-inclusive naira price for MVP". The customer sees one
// number, pays it, and is never asked to top up. Everything below exists to
// help ops ARRIVE at that number and to record how — it is not a runtime
// pricing engine, and the storefront never sees it.
//
// `locked_price` on the offer is authoritative. If someone later edits a
// component, the customer-facing price does not move until a human
// re-locks it. That asymmetry is deliberate: §5.3 requires historical
// totals to survive catalogue and FX changes, and the simplest way to
// guarantee that is for the price never to be derived at read time.
//
// ── Money ───────────────────────────────────────────────────────────────
// Everything naira is kobo integers, matching the house rule set by
// modules/commission-entry. Source costs stay in their original currency
// (§5.3 "internally, the system may store source cost and exchange-rate
// details in their original currencies").

export type CostComponents = {
  /** Supplier price in the source currency's minor unit (US cents). */
  source_price?: number
  source_currency?: string
  /** NGN per 1 unit of source currency, at the moment the price was set. */
  fx_rate?: number

  // Everything below is kobo.
  freight?: number
  insurance?: number
  duty?: number
  clearing?: number
  local_delivery?: number
  margin?: number
  contingency?: number
}

export type LandedCost = {
  /** Source price converted to kobo at the recorded rate. */
  sourceCostNgn: number
  /** Freight + insurance + duty + clearing + local delivery, in kobo. */
  landedAddOns: number
  /** Margin + contingency, in kobo. */
  uplift: number
  /** The sum — what the locked price SHOULD be, in kobo. */
  total: number
}

const kobo = (value: unknown): number => {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

/**
 * Compose a landed cost from its components.
 *
 * Used by the admin pricing form to suggest a price, and by reporting to
 * show margin. Never used to price a live cart.
 */
export const computeLandedCost = (components: CostComponents): LandedCost => {
  const sourcePrice = kobo(components.source_price)
  const rate = Number(components.fx_rate ?? 0)

  // Source price is in the source currency's minor unit, so converting
  // gives kobo directly — cents × (naira per dollar) × 100 / 100.
  const sourceCostNgn =
    Number.isFinite(rate) && rate > 0 ? Math.round(sourcePrice * rate) : 0

  const landedAddOns =
    kobo(components.freight) +
    kobo(components.insurance) +
    kobo(components.duty) +
    kobo(components.clearing) +
    kobo(components.local_delivery)

  const uplift = kobo(components.margin) + kobo(components.contingency)

  return {
    sourceCostNgn,
    landedAddOns,
    uplift,
    total: sourceCostNgn + landedAddOns + uplift,
  }
}

/** Margin in kobo and as a fraction of the locked price. */
export const marginOn = (
  lockedPrice: number,
  components: CostComponents
): { amount: number; rate: number } => {
  const cost = computeLandedCost(components)
  const costWithoutUplift = cost.sourceCostNgn + cost.landedAddOns
  const amount = kobo(lockedPrice) - costWithoutUplift
  const rate = lockedPrice > 0 ? amount / kobo(lockedPrice) : 0
  return { amount, rate }
}

/**
 * Whether a locked price still resembles its components.
 *
 * Ops sets the price once and components drift afterwards — FX moves,
 * freight is re-quoted. This does not change the price; it flags offers
 * worth re-locking, so an offer quietly selling below cost gets noticed
 * before finance notices it at month end.
 */
export const priceDrift = (
  lockedPrice: number,
  components: CostComponents
): { suggested: number; deltaKobo: number; deltaRate: number } => {
  const suggested = computeLandedCost(components).total
  const deltaKobo = suggested - kobo(lockedPrice)
  const deltaRate = lockedPrice > 0 ? deltaKobo / kobo(lockedPrice) : 0
  return { suggested, deltaKobo, deltaRate }
}

/**
 * The cost disclosure shown at checkout (§6.4 "clearly states whether import
 * duty, clearing, local delivery, and other charges are included").
 *
 * Returns customer-facing sentences, never figures — the breakdown is
 * internal. The customer needs to know what they will NOT be billed for
 * later, which is the actual anxiety with an imported purchase.
 */
export const inclusionSummary = (offer: {
  includes_duty?: boolean
  includes_clearing?: boolean
  includes_local_delivery?: boolean
}): { included: string[]; excluded: string[] } => {
  const rows: [boolean, string][] = [
    [offer.includes_duty !== false, "Import duty"],
    [offer.includes_clearing !== false, "Customs clearing"],
    [offer.includes_local_delivery !== false, "Delivery within Nigeria"],
  ]

  return {
    included: rows.filter(([on]) => on).map(([, label]) => label),
    excluded: rows.filter(([on]) => !on).map(([, label]) => label),
  }
}

/**
 * Freeze the commercial facts of an offer onto a paid pre-order.
 *
 * §6.6 requires a paid order to record an immutable price and exchange-rate
 * snapshot. Everything the order needs is copied, so a later edit to the
 * offer — or its deletion — cannot rewrite what was agreed.
 */
export const snapshotOffer = (offer: any, quantity: number) => ({
  unit_price: kobo(offer.locked_price),
  currency_code: offer.currency_code ?? "ngn",
  cost_snapshot: (offer.cost_components ?? null) as CostComponents | null,
  fx_rate: offer.fx_rate ?? null,
  quantity,
  condition: offer.condition ?? null,
  warranty_text: offer.warranty_text ?? null,
  return_policy_text: offer.return_policy_text ?? null,
})
