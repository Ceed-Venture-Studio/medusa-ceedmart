import { model } from "@medusajs/framework/utils"

// Immutable per-order commission accrual (spec §7 incentive_ledger,
// simplified for Partner-only MVP). Each row freezes the driving order
// snapshot + the rate used at accrual time, so future rate changes never
// rewrite payout history.
//
// Lifecycle:
//   pending  → order placed with a partner_code; not yet delivered/paid.
//   earned   → order marked completed (spec §2 verified state).
//   reversed → refund/cancellation posted; amount stored as negative.
//
// Amounts are stored in the smallest currency unit (kobo for NGN) to
// match the spec's "store money in kobo as integers" guidance.

const CommissionEntry = model
  .define("CommissionEntry", {
    id: model.id({ prefix: "cmi" }).primaryKey(),

    // Attribution snapshot.
    partner_id: model.text(),
    partner_code: model.text(),

    // Driving order snapshot.
    order_id: model.text(),
    order_display_id: model.number().nullable(),
    // Order metric used to compute commission (kobo). We snapshot rather
    // than joining so downstream reads never depend on the order module's
    // current value.
    eligible_amount: model.bigNumber(),
    // Whichever amount basis was used at accrual time (subtotal /
    // subtotal_ex_tax / total). Kept for audit + future re-computation.
    eligible_basis: model.text().default("subtotal_ex_tax"),
    currency_code: model.text(),

    // Frozen rate + resulting amount (kobo). Rate is a decimal like 0.07.
    commission_rate: model.number(),
    commission_amount: model.bigNumber(),

    status: model.text().default("pending"),
    reason: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["partner_id"] },
    { on: ["order_id"] },
    { on: ["status"] },
    { on: ["created_at"] },
  ])

export default CommissionEntry
