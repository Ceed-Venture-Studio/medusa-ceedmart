// Delivery-estimate arithmetic for US pre-orders (BRD §6.2, D-01).
//
// ── The rule ────────────────────────────────────────────────────────────
// The window is NOT a hardcoded fourteen days. It is three settable legs
// on the offer — procurement, international transit, customs — summed, with
// an optional override for a supplier whose real behaviour does not
// decompose neatly. Ops tunes each leg as real delivery data arrives, and a
// supplier that reliably ships in two days stops being averaged with one
// that takes ten.
//
// ── When the clock starts ───────────────────────────────────────────────
// §6.2: from successful payment AND sourcing confirmation. Not from order
// placement — we cannot promise a window for an item we have not confirmed
// is buyable. Before confirmation the customer sees an estimate; after it,
// a promised date.
//
// ── When the clock pauses ───────────────────────────────────────────────
// §6.2: the promise pauses while the customer must approve a price change,
// substitution or address correction. Paused time accumulates and pushes
// the promised date out by the same amount, so waiting on the customer
// never counts against us — and, more importantly, is never hidden by
// quietly letting the date slip.

export type EstimateLegs = {
  procurement_days?: number | null
  transit_days?: number | null
  customs_days?: number | null
  total_days_override?: number | null
}

export type EstimateBreakdown = {
  procurementDays: number
  transitDays: number
  customsDays: number
  totalDays: number
  /** True when total_days_override replaced the summed legs. */
  isOverridden: boolean
}

const DEFAULTS = { procurement: 3, transit: 7, customs: 4 }

const asDays = (value: number | null | undefined, fallback: number): number => {
  if (value === null || value === undefined) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.ceil(n)
}

/** Break an offer's window into its legs, applying defaults and override. */
export const estimateBreakdown = (legs: EstimateLegs): EstimateBreakdown => {
  const procurementDays = asDays(legs.procurement_days, DEFAULTS.procurement)
  const transitDays = asDays(legs.transit_days, DEFAULTS.transit)
  const customsDays = asDays(legs.customs_days, DEFAULTS.customs)

  const summed = procurementDays + transitDays + customsDays
  const override = legs.total_days_override

  const hasOverride =
    override !== null &&
    override !== undefined &&
    Number.isFinite(Number(override)) &&
    Number(override) > 0

  return {
    procurementDays,
    transitDays,
    customsDays,
    totalDays: hasOverride ? Math.ceil(Number(override)) : summed,
    isOverridden: hasOverride,
  }
}

/** Total calendar days for an offer. */
export const estimateDays = (legs: EstimateLegs): number =>
  estimateBreakdown(legs).totalDays

/**
 * The date a customer is shown, before payment.
 *
 * Calendar days, not business days — a Nigerian shopper reading "arrives by
 * the 19th" does not care which of those days we worked, and the BRD's
 * default is explicitly calendar days.
 */
export const estimatedDeliveryDate = (
  legs: EstimateLegs,
  from: Date = new Date()
): Date => addDays(from, estimateDays(legs))

/**
 * The promised date recorded on a paid pre-order.
 *
 * `clockStartedAt` should be the moment sourcing was confirmed, not payment,
 * per §6.2. `pausedDays` is time already spent waiting on the customer.
 */
export const promisedDeliveryDate = (
  legs: EstimateLegs,
  clockStartedAt: Date,
  pausedDays = 0
): Date => addDays(clockStartedAt, estimateDays(legs) + Math.max(0, pausedDays))

/**
 * Days a pre-order has spent paused, including any pause still open.
 *
 * Rounds UP a partial day: a promise that is late by hours is late, and
 * rounding in our own favour is how a two-week promise quietly becomes
 * sixteen days.
 */
export const accumulatedPausedDays = (
  storedPausedDays: number,
  pausedAt: Date | null | undefined,
  now: Date = new Date()
): number => {
  const base = Math.max(0, storedPausedDays || 0)
  if (!pausedAt) return base

  const elapsedMs = now.getTime() - pausedAt.getTime()
  if (elapsedMs <= 0) return base

  return base + Math.ceil(elapsedMs / (24 * 60 * 60 * 1000))
}

/** Whether a promised date has been missed. */
export const isOverdue = (
  promisedDate: Date | null | undefined,
  now: Date = new Date()
): boolean => {
  if (!promisedDate) return false
  return now.getTime() > promisedDate.getTime()
}

/**
 * Whether an offer can still be added to a cart (§6.4).
 *
 * Availability verification going stale is the main reason a pre-order
 * fails after payment, so an offer whose last check is older than
 * `maxVerificationAgeDays` is treated as unsellable rather than optimistic.
 */
export const isOfferSellable = (
  offer: {
    is_active?: boolean
    offer_expires_at?: Date | string | null
    availability_verified_at?: Date | string | null
  },
  options: { maxVerificationAgeDays?: number; now?: Date } = {}
): { sellable: boolean; reason?: string } => {
  const now = options.now ?? new Date()

  if (offer.is_active === false) {
    return { sellable: false, reason: "This pre-order is not currently available." }
  }

  const expires = toDate(offer.offer_expires_at)
  if (expires && expires.getTime() <= now.getTime()) {
    return { sellable: false, reason: "This pre-order offer has expired." }
  }

  const maxAge = options.maxVerificationAgeDays
  if (maxAge && maxAge > 0) {
    const verified = toDate(offer.availability_verified_at)
    if (!verified) {
      return {
        sellable: false,
        reason: "This pre-order is awaiting an availability check.",
      }
    }
    const ageDays = (now.getTime() - verified.getTime()) / (24 * 60 * 60 * 1000)
    if (ageDays > maxAge) {
      return {
        sellable: false,
        reason: "This pre-order is awaiting an availability check.",
      }
    }
  }

  return { sellable: true }
}

/** Whether an offer delivers to a given Nigerian state. Empty list means
 *  nationwide. */
export const deliversTo = (
  deliveryStates: unknown,
  state: string | null | undefined
): boolean => {
  if (!Array.isArray(deliveryStates) || deliveryStates.length === 0) return true
  if (!state) return false
  const wanted = state.trim().toLowerCase()
  return deliveryStates.some(
    (s) => typeof s === "string" && s.trim().toLowerCase() === wanted
  )
}

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
