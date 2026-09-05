// Cancellation and refund rules for US pre-orders (BRD §6.4, §6.5, D-03).
//
// ── The cutoff ──────────────────────────────────────────────────────────
// D-03: "free cancellation before supplier purchase; policy-based
// resolution afterward." §6.5 puts it as "cancellation may be unrestricted
// before sourcing and restricted after supplier purchase."
//
// The line is `purchased` — the moment Ceedmart's money is committed to a
// supplier. Before it, cancelling costs us nothing and the customer gets
// everything back. After it, we own an item in a US warehouse, and whether
// the customer gets all their money back is a commercial decision rather
// than an automatic one.
//
// The state machine already refuses `purchased → cancelled`. This module
// says WHY, and what the customer is owed instead — the machine enforces,
// this explains.

export type CancellationWindow = "free" | "restricted" | "closed"

export type RefundReasonCode =
  | "customer_changed_mind"
  | "unable_to_source"
  | "price_increase_rejected"
  | "substitution_rejected"
  | "delivery_failed"
  | "item_damaged"
  | "duplicate_order"
  | "goodwill"

export const REFUND_REASONS: Record<
  RefundReasonCode,
  { label: string; customerFault: boolean }
> = {
  customer_changed_mind: {
    label: "Customer changed their mind",
    customerFault: true,
  },
  unable_to_source: { label: "Could not be sourced", customerFault: false },
  price_increase_rejected: {
    label: "Customer declined a price increase",
    customerFault: false,
  },
  substitution_rejected: {
    label: "Customer declined a substitution",
    customerFault: false,
  },
  delivery_failed: { label: "Delivery could not be completed", customerFault: false },
  item_damaged: { label: "Item arrived damaged", customerFault: false },
  duplicate_order: { label: "Duplicate order", customerFault: false },
  goodwill: { label: "Goodwill", customerFault: false },
}

export const isValidReasonCode = (code: string): code is RefundReasonCode =>
  Object.prototype.hasOwnProperty.call(REFUND_REASONS, code)

// Statuses before Ceedmart has committed money to a supplier.
const PRE_COMMITMENT = new Set([
  "draft",
  "awaiting_payment",
  "paid",
  "availability_check",
  "sourcing_confirmed",
])

// Statuses after which nothing is left to cancel.
const TERMINAL = new Set(["delivered", "refunded", "cancelled"])

/** Which cancellation window a pre-order is currently in. */
export const cancellationWindow = (status: string): CancellationWindow => {
  if (TERMINAL.has(status)) return "closed"
  if (PRE_COMMITMENT.has(status)) return "free"
  return "restricted"
}

/**
 * What the customer can be told about cancelling right now.
 *
 * Written as customer-facing copy on purpose: these sentences appear on the
 * order page and in support replies, and a policy explained in two
 * different voices is a policy people argue about.
 */
export const cancellationNotice = (status: string): string => {
  switch (cancellationWindow(status)) {
    case "free":
      return "You can cancel this pre-order for a full refund — we haven't bought it from our supplier yet."
    case "restricted":
      return "We've already bought this item from our US supplier, so cancelling now needs a quick chat with our team. Contact support and we'll work out the best option."
    case "closed":
      return "This pre-order can no longer be cancelled."
  }
}

/** Whether the customer may cancel without staff involvement. */
export const canSelfCancel = (status: string): boolean =>
  cancellationWindow(status) === "free"

/**
 * Refund amount owed for a full cancellation, in kobo.
 *
 * Before supplier commitment the customer is made whole, full stop. After
 * it, the amount is a human decision — this returns null rather than
 * guessing, because a wrong automatic number is worse than no number.
 */
export const automaticRefundAmount = (
  status: string,
  paidAmount: number
): number | null => {
  if (cancellationWindow(status) === "free") return Math.max(0, paidAmount)
  return null
}

/**
 * Whether a refund is owed in full regardless of window.
 *
 * When the failure is ours — we could not source it, the item arrived
 * damaged, delivery failed, or the customer declined a change WE proposed
 * — the cancellation cutoff does not apply. Charging someone for our
 * inability to deliver is not a policy, it is a complaint.
 */
export const owesFullRefund = (reason: RefundReasonCode): boolean =>
  REFUND_REASONS[reason]?.customerFault === false
