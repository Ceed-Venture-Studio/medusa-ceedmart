import { defineStateMachine } from "."

// Concrete state machines, transcribed from the Phase 3 BRD.
//
// Each machine lists only the moves the business actually allows. Anything
// absent is rejected with a message naming the legal targets, so an operator
// who tries an illegal move learns what they can do instead.

// ── Solar quotes (existing, retrofitted) ────────────────────────────────
// Was a bare `ALLOWED` Set in the status route that accepted any known
// status from any other. A quote that was already `won` could be flipped
// back to `new`. Now the sales funnel only runs forwards, and both terminal
// states are final.
export const solarQuoteMachine = defineStateMachine({
  entityType: "solar_quote",
  transitions: {
    new: ["contacted", "lost"],
    contacted: ["quoted", "lost"],
    quoted: ["won", "lost"],
    won: [],
    lost: [],
  },
  terminal: ["won", "lost"],
} as const)

export type SolarQuoteStatus = ReturnType<
  typeof solarQuoteMachine.states
>[number]

// ── US Pre-Order (BRD §6.4) ─────────────────────────────────────────────
// The happy path is linear. Every non-terminal state can also fail out to
// an exception, because sourcing can collapse at any point — the supplier
// runs out, customs holds the shipment, the customer stops responding to an
// approval request.
const PREORDER_EXCEPTIONS = [
  "cancelled",
  "unable_to_source",
  "delivery_exception",
  "refund_pending",
] as const

export const preorderMachine = defineStateMachine({
  entityType: "preorder",
  transitions: {
    draft: ["awaiting_payment", "cancelled"],
    awaiting_payment: ["paid", ...PREORDER_EXCEPTIONS],
    paid: ["availability_check", ...PREORDER_EXCEPTIONS],
    availability_check: ["sourcing_confirmed", ...PREORDER_EXCEPTIONS],
    sourcing_confirmed: ["purchased", ...PREORDER_EXCEPTIONS],
    // Once the supplier has been paid, cancellation stops being free —
    // §6.5 makes this the cutoff, so `cancelled` is deliberately no longer
    // reachable from here without going through a refund.
    purchased: [
      "at_us_facility",
      "unable_to_source",
      "delivery_exception",
      "refund_pending",
    ],
    at_us_facility: ["in_international_transit", "delivery_exception", "refund_pending"],
    in_international_transit: ["customs_clearance", "delivery_exception", "refund_pending"],
    customs_clearance: ["at_nigeria_facility", "delivery_exception", "refund_pending"],
    at_nigeria_facility: ["out_for_delivery", "delivery_exception"],
    out_for_delivery: ["delivered", "delivery_exception"],
    delivered: [],

    // Exception states.
    delivery_exception: ["out_for_delivery", "refund_pending", "cancelled"],
    unable_to_source: ["refund_pending", "cancelled"],
    refund_pending: ["refunded"],
    refunded: [],
    cancelled: [],
  },
  terminal: ["delivered", "refunded", "cancelled"],
  // §5.5 — an exception needs an explanation the customer can be given.
  requireReason: [
    "cancelled",
    "unable_to_source",
    "delivery_exception",
    "refund_pending",
  ],
} as const)

// Customer-facing collapse of the twelve staff milestones (§6.4 "customers
// see a simplified, understandable version"). Shoppers do not need to know
// the difference between a US facility and international transit.
export const PREORDER_CUSTOMER_STAGE: Record<string, string> = {
  draft: "Not yet placed",
  awaiting_payment: "Awaiting payment",
  paid: "Confirming availability",
  availability_check: "Confirming availability",
  sourcing_confirmed: "Sourcing your item",
  purchased: "Sourcing your item",
  at_us_facility: "On its way from the US",
  in_international_transit: "On its way from the US",
  customs_clearance: "Clearing customs",
  at_nigeria_facility: "In Nigeria, preparing delivery",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_exception: "Delayed — we're on it",
  unable_to_source: "Could not be sourced",
  refund_pending: "Refund in progress",
  refunded: "Refunded",
  cancelled: "Cancelled",
}

// ── Custom build (BRD §7.7) ─────────────────────────────────────────────
export const buildOrderMachine = defineStateMachine({
  entityType: "build_order",
  transitions: {
    request_draft: ["submitted", "cancelled"],
    submitted: ["under_review", "cancelled"],
    under_review: ["more_information_required", "quote_ready", "unable_to_fulfil", "cancelled"],
    more_information_required: ["under_review", "cancelled"],
    quote_ready: ["quote_accepted", "revision_requested", "rejected", "quote_expired"],
    revision_requested: ["quote_ready", "rejected", "cancelled"],
    quote_accepted: ["awaiting_payment", "cancelled"],
    awaiting_payment: ["paid", "cancelled"],
    paid: ["parts_sourcing", "refund_pending"],
    parts_sourcing: ["assembly", "unable_to_fulfil", "refund_pending"],
    assembly: ["quality_assurance", "unable_to_fulfil", "refund_pending"],
    quality_assurance: ["ready_for_dispatch", "assembly", "unable_to_fulfil"],
    ready_for_dispatch: ["out_for_delivery"],
    out_for_delivery: ["delivered"],
    delivered: [],

    // Terminal and exception states.
    quote_expired: [],
    rejected: [],
    cancelled: [],
    unable_to_fulfil: ["refund_pending"],
    refund_pending: ["refunded"],
    refunded: [],
  },
  terminal: [
    "delivered",
    "quote_expired",
    "rejected",
    "cancelled",
    "refunded",
  ],
  requireReason: ["cancelled", "rejected", "unable_to_fulfil", "refund_pending"],
} as const)

// ── Auction (BRD §8.5) ──────────────────────────────────────────────────
export const auctionMachine = defineStateMachine({
  entityType: "auction",
  transitions: {
    draft: ["scheduled", "cancelled"],
    scheduled: ["live", "cancelled"],
    // Closing is driven by the scheduler, never by an operator.
    live: ["ended", "cancelled"],
    ended: ["awaiting_winner_payment", "reserve_not_met", "cancelled"],
    reserve_not_met: [],
    awaiting_winner_payment: ["paid", "winner_defaulted", "cancelled"],
    winner_defaulted: ["offered_to_next_bidder", "cancelled"],
    offered_to_next_bidder: ["awaiting_winner_payment", "cancelled"],
    paid: ["fulfilment", "disputed", "refund_pending"],
    fulfilment: ["completed", "disputed"],
    completed: [],
    disputed: ["fulfilment", "refund_pending", "completed"],
    refund_pending: ["refunded"],
    refunded: [],
    cancelled: [],
  },
  terminal: ["completed", "reserve_not_met", "refunded", "cancelled"],
  // §8.10 — cancelling after bidding starts needs a reason visible in the
  // audit log, and a winner default needs one for the disclosed penalty.
  requireReason: [
    "cancelled",
    "winner_defaulted",
    "disputed",
    "refund_pending",
  ],
} as const)
