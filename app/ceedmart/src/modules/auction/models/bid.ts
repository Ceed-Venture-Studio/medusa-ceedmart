import { model } from "@medusajs/framework/utils"

// One bid. Immutable (BRD §8.6).
//
// "Every bid receives an immutable sequence number and server timestamp."
// "Administrators cannot edit or delete accepted bids. Invalid bids can only
// be voided through a recorded, permission-controlled process that preserves
// the audit trail."
//
// So there is no update path for amount, bidder or sequence. Voiding sets
// `voided_at` and a reason — the row stays, and the sequence it consumed
// stays consumed, so the ledger cannot be made to read as though the bid
// never happened.
//
// The unique index on (auction_id, sequence) is the concurrency guarantee:
// two simultaneous bids cannot both take the same sequence, because Postgres
// refuses — not because the application checked.

const Bid = model
  .define("Bid", {
    id: model.id({ prefix: "bid" }).primaryKey(),
    auction_id: model.text(),
    // Monotonic per auction, assigned inside the bid transaction.
    sequence: model.number(),

    bidder_id: model.text(),
    // Masked handle shown in public history, e.g. "Bidder ••••4821"
    // (§8.6). Frozen at first bid so a bidder reads consistently down the
    // whole history.
    bidder_handle: model.text(),

    amount: model.bigNumber(),
    currency_code: model.text().default("ngn"),

    // §8.8 — server time is authoritative, and the earliest accepted
    // timestamp wins a tie.
    placed_at: model.dateTime(),

    // "bid" | "buy_now"
    kind: model.text().default("bid"),

    // Voiding, per §8.6. Never deletion.
    voided_at: model.dateTime().nullable(),
    voided_by: model.text().nullable(),
    void_reason: model.text().nullable(),

    // Whether this bid triggered an anti-snipe extension, so the history
    // can explain why the clock moved.
    triggered_extension: model.boolean().default(false),

    ip_address: model.text().nullable(),
    user_agent: model.text().nullable(),
  })
  .indexes([
    { on: ["auction_id"] },
    { on: ["auction_id", "sequence"], unique: true },
    { on: ["bidder_id"] },
    { on: ["placed_at"] },
    { on: ["voided_at"] },
  ])

export default Bid
