import { model } from "@medusajs/framework/utils"

// The snapshot taken when an auction closes (BRD §8.8).
//
// "The winning amount, bidder, closing time, reserve outcome, and applicable
// terms are snapshotted." Written once by the closing job and never updated,
// so a later edit to the auction — or a voided bid — cannot rewrite who won
// what for how much.
//
// Its existence is also the closing job's idempotency marker: a unique index
// on auction_id means a job that runs twice produces one result, not two.

const AuctionResult = model
  .define("AuctionResult", {
    id: model.id({ prefix: "aures" }).primaryKey(),
    auction_id: model.text().unique(),

    // Null when the reserve was not met — §8.8 requires closing to select
    // no winner in that case, rather than the highest bidder by default.
    winning_bid_id: model.text().nullable(),
    winner_id: model.text().nullable(),
    winning_amount: model.bigNumber().nullable(),
    currency_code: model.text().default("ngn"),

    closed_at: model.dateTime(),
    reserve_met: model.boolean().default(false),
    // Snapshotted so a later change to the auction's reserve cannot make a
    // past outcome look wrong.
    reserve_price: model.bigNumber().nullable(),
    bid_count: model.number().default(0),
    unique_bidders: model.number().default(0),
    terms_version_id: model.text().nullable(),

    // Set when the winner defaults and the item is offered on (§8.9).
    superseded_by_offer_id: model.text().nullable(),
  })
  .indexes([{ on: ["auction_id"], unique: true }, { on: ["winner_id"] }])

export default AuctionResult
