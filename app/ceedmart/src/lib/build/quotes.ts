import { MedusaError } from "@medusajs/framework/utils"

// Quote versioning and acceptance rules (BRD §7.6, §7.9).
//
// Three rules the BRD states flatly, implemented here so they hold
// everywhere rather than being remembered at each call site:
//
//   1. "Quotes are versioned. Changes create a new version without
//      overwriting prior versions."
//   2. "Only the latest valid quote can be accepted."
//   3. "Estimates are not binding until an authorised quote is accepted."
//
// Rule 2 is the subtle one. "Latest" and "valid" are separate conditions: a
// customer holding an emailed link to v2 must not be able to accept it
// after v3 was issued, AND must not be able to accept v3 after it expired.
// Both are checked server-side, because the link in their inbox is the one
// thing we do not control.

export type QuoteLineItem = {
  label: string
  description?: string | null
  category?: string | null
  quantity: number
  /** Kobo. */
  unit_price: number
  variant_id?: string | null
}

export type QuoteTotals = {
  subtotal: number
  discount_total: number
  tax_total: number
  delivery_total: number
  total: number
}

const kobo = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Total a quote's lines.
 *
 * Computed server-side from the lines, never taken from the client — §7.9
 * requires all price validations be repeated on the server, and a total
 * that does not follow from its own line items is how a quote becomes
 * unarguable in the wrong direction.
 */
export const computeQuoteTotals = (
  lineItems: QuoteLineItem[],
  serviceItems: QuoteLineItem[] = [],
  adjustments: {
    discount_total?: number
    tax_total?: number
    delivery_total?: number
  } = {}
): QuoteTotals => {
  const sum = (items: QuoteLineItem[]) =>
    items.reduce(
      (acc, item) => acc + kobo(item.unit_price) * Math.max(0, kobo(item.quantity)),
      0
    )

  const subtotal = sum(lineItems) + sum(serviceItems)
  const discount = Math.min(kobo(adjustments.discount_total), subtotal)
  const tax = kobo(adjustments.tax_total)
  const delivery = kobo(adjustments.delivery_total)

  return {
    subtotal,
    discount_total: discount,
    tax_total: tax,
    delivery_total: delivery,
    total: subtotal - discount + tax + delivery,
  }
}

/** Reject a quote with no priced content — an empty quote accepted is an
 *  agreement to nothing for nothing. */
export const assertQuotable = (lineItems: QuoteLineItem[]): void => {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A quote needs at least one line item"
    )
  }

  for (const item of lineItems) {
    if (!item.label?.trim()) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Every quote line needs a label the customer can read"
      )
    }
    if (kobo(item.quantity) <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Line "${item.label}" needs a quantity of at least 1`
      )
    }
    if (kobo(item.unit_price) < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Line "${item.label}" cannot have a negative price`
      )
    }
  }
}

export type AcceptabilityFailure =
  | "not_latest"
  | "expired"
  | "not_sent"
  | "already_accepted"
  | "quote_closed"

export type Acceptability = {
  acceptable: boolean
  failure?: AcceptabilityFailure
  message?: string
}

/**
 * Whether a specific version may be accepted right now.
 *
 * Returns a reason rather than a bare boolean so the customer is told what
 * happened — "this quote was updated" and "this quote expired" need
 * different next steps, and a generic refusal makes both look like a bug.
 */
export const canAcceptVersion = (
  quote: {
    status: string
    current_version_id?: string | null
    accepted_version_id?: string | null
  },
  version: { id: string; sent_at?: Date | string | null; valid_until: Date | string },
  now: Date = new Date()
): Acceptability => {
  if (quote.status === "accepted" || quote.accepted_version_id) {
    return {
      acceptable: false,
      failure: "already_accepted",
      message: "This quote has already been accepted.",
    }
  }

  if (quote.status === "rejected" || quote.status === "expired") {
    return {
      acceptable: false,
      failure: "quote_closed",
      message: "This quote is no longer open.",
    }
  }

  // A draft has not been issued to anybody, so there is nothing to accept.
  if (!version.sent_at) {
    return {
      acceptable: false,
      failure: "not_sent",
      message: "This quote has not been sent yet.",
    }
  }

  // Rule 2, first half — the version in the customer's inbox may have been
  // superseded since it was emailed.
  if (quote.current_version_id && quote.current_version_id !== version.id) {
    return {
      acceptable: false,
      failure: "not_latest",
      message:
        "This quote has been updated since it was sent. Please review the latest version.",
    }
  }

  // Rule 2, second half.
  const validUntil =
    version.valid_until instanceof Date
      ? version.valid_until
      : new Date(version.valid_until)

  if (Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= now.getTime()) {
    return {
      acceptable: false,
      failure: "expired",
      message:
        "This quote has expired. Component prices move, so we'll need to prepare a fresh one.",
    }
  }

  return { acceptable: true }
}

/** Default validity window. Short on purpose: a quote is priced against
 *  component costs that move, and §7.9 requires availability be rechecked
 *  at acceptance anyway. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = Number(
  process.env.BUILD_QUOTE_VALIDITY_DAYS || 14
)

export const defaultValidUntil = (from: Date = new Date()): Date => {
  const until = new Date(from.getTime())
  until.setDate(until.getDate() + DEFAULT_QUOTE_VALIDITY_DAYS)
  return until
}

/**
 * Human-readable reference for support (§9.4).
 *
 * Short enough to read over the phone and type into WhatsApp. Ambiguous
 * characters are excluded — someone reading "CB-I0O1" aloud will not be
 * understood, and support then works the wrong record.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export const generateReference = (prefix: string, length = 6): string => {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return `${prefix}-${out}`
}
