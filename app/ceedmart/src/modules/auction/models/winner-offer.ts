import { model } from "@medusajs/framework/utils"

// A time-limited offer to buy the item (BRD §8.9).
//
// Covers both the winner's own payment window and, if they default, the
// offer passed to the next eligible bidder.
//
// §8.9 is explicit: the next-bidder offer "must be a NEW time-limited offer
// and must NOT silently charge that bidder". So an offer is an invitation
// with a deadline, never an authorisation — nothing here can move money on
// its own.

const WinnerOffer = model
  .define("WinnerOffer", {
    id: model.id({ prefix: "auwo" }).primaryKey(),
    auction_id: model.text(),
    bidder_id: model.text(),
    bid_id: model.text().nullable(),

    amount: model.bigNumber(),
    currency_code: model.text().default("ngn"),

    // Which bidder in the ranking this is: 1 = the winner, 2 = first
    // fallback, and so on. Useful in a dispute about who was asked when.
    rank: model.number().default(1),

    offered_at: model.dateTime(),
    expires_at: model.dateTime(),
    // "pending" | "paid" | "expired" | "declined" | "withdrawn"
    status: model.text().default("pending"),

    paid_at: model.dateTime().nullable(),
    order_id: model.text().nullable(),
    declined_at: model.dateTime().nullable(),

    // Reminders already sent, so a job re-run does not nag someone twice.
    reminders_sent: model.number().default(0),
    last_reminder_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["auction_id"] },
    { on: ["bidder_id"] },
    { on: ["status"] },
    { on: ["expires_at"] },
  ])

export default WinnerOffer
