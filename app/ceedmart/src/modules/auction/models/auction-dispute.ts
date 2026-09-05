import { model } from "@medusajs/framework/utils"

// A raised dispute about an auction (BRD §8.10).
//
// "A support workflow must capture payment, condition, bid-validity, and
// fulfilment disputes."

const AuctionDispute = model
  .define("AuctionDispute", {
    id: model.id({ prefix: "audis" }).primaryKey(),
    auction_id: model.text(),
    raised_by: model.text().nullable(),

    // "payment" | "condition" | "bid_validity" | "fulfilment" | "other"
    kind: model.text(),
    description: model.text(),
    evidence: model.json().nullable(),

    // "open" | "investigating" | "resolved" | "rejected"
    status: model.text().default("open"),
    resolution: model.text().nullable(),
    resolved_at: model.dateTime().nullable(),
    resolved_by: model.text().nullable(),
  })
  .indexes([
    { on: ["auction_id"] },
    { on: ["status"] },
    { on: ["kind"] },
  ])

export default AuctionDispute
