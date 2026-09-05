import { model } from "@medusajs/framework/utils"

// A refundable deposit or payment-method hold placed to bid (BRD §8.2, D-10).
//
// "Where configured, customer provides a refundable bidder deposit or
// payment-method authorisation." §8.8 then requires losing bidders' deposits
// or holds be released according to policy.
//
// Authorisation and capture are deliberately separate columns: a hold that
// was authorised but never captured must never read as money we took, and
// releasing it is a distinct event from refunding a capture.

const BidderDeposit = model
  .define("BidderDeposit", {
    id: model.id({ prefix: "audep" }).primaryKey(),
    auction_id: model.text(),
    bidder_id: model.text(),

    amount: model.bigNumber(),
    currency_code: model.text().default("ngn"),

    // "authorized" — held on the payment method, not taken.
    // "captured"   — actually charged, e.g. applied to the winning total.
    // "released"   — hold lifted, nothing taken.
    // "forfeited"  — retained under the disclosed default policy (§8.9).
    // "refunded"   — captured, then returned.
    status: model.text().default("authorized"),

    // Provider references, kept apart so a release and a refund are never
    // confused for one another.
    authorization_reference: model.text().nullable(),
    capture_reference: model.text().nullable(),
    refund_reference: model.text().nullable(),

    authorized_at: model.dateTime().nullable(),
    captured_at: model.dateTime().nullable(),
    released_at: model.dateTime().nullable(),
    forfeited_at: model.dateTime().nullable(),
    forfeit_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["auction_id"] },
    { on: ["bidder_id"] },
    { on: ["auction_id", "bidder_id"], unique: true },
    { on: ["status"] },
  ])

export default BidderDeposit
