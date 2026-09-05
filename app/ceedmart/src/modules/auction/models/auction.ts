import { model } from "@medusajs/framework/utils"

// A timed, ascending-price auction (BRD §8.1, §8.4).
//
// CeedMart is the seller in this release (D-08). Each auction sells ONE
// unique inventory unit — §8.11 requires that unit cannot be sold through
// another checkout while reserved or fulfilled, which is why the auction
// owns a specific unit rather than a quantity of a variant.
//
// ── On time ─────────────────────────────────────────────────────────────
// §8.8: "server time is authoritative." Every timestamp here is set and
// compared server-side; the client's clock is display only. `ends_at` moves
// when anti-sniping extends it (§8.7), and the new value is persisted so a
// restart cannot lose an extension.

const Auction = model
  .define("Auction", {
    id: model.id({ prefix: "auc" }).primaryKey(),
    reference: model.text().unique(),

    title: model.text().searchable(),
    description: model.text().nullable(),

    // The unique unit being sold.
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),
    inventory_item_id: model.text().nullable(),
    stock_location_id: model.text().nullable(),
    // Serial or asset tag — §8.4 wants a reference number for the exact
    // unit, since "the same model" is not the same item at auction.
    unit_reference: model.text().nullable(),

    // ── Condition disclosure (§8.4) ───────────────────────────────
    // "new" | "open_box" | "refurbished" | "used" | "for_parts"
    condition: model.text().default("used"),
    condition_report: model.text().nullable(),
    known_defects: model.json().nullable(),
    images: model.json().nullable(),
    inspection_details: model.text().nullable(),

    // ── Schedule — stored UTC, displayed with an explicit timezone ─
    starts_at: model.dateTime(),
    ends_at: model.dateTime(),
    // Never moves. Kept so an extended auction can show how far it ran past
    // its advertised close.
    original_ends_at: model.dateTime().nullable(),

    // ── Money, kobo ───────────────────────────────────────────────
    starting_price: model.bigNumber(),
    min_increment: model.bigNumber(),
    // Hidden from bidders (§8.3). Only whether it is MET is ever exposed.
    reserve_price: model.bigNumber().nullable(),
    buy_now_price: model.bigNumber().nullable(),
    deposit_amount: model.bigNumber().nullable(),
    currency_code: model.text().default("ngn"),

    // Denormalised live state. Authoritative values are derived from the
    // bid ledger; these exist so the poll endpoint is one row read rather
    // than an aggregate on every request from every viewer.
    current_price: model.bigNumber().nullable(),
    bid_count: model.number().default(0),
    leading_bidder_id: model.text().nullable(),
    leading_bid_id: model.text().nullable(),
    // Monotonic per auction. The unique index on (auction_id, sequence) is
    // what makes concurrent bids resolve to one winner.
    last_sequence: model.number().default(0),

    // ── Anti-sniping (§8.7) ───────────────────────────────────────
    antisnipe_window_seconds: model.number().default(300),
    antisnipe_extension_seconds: model.number().default(300),
    extension_count: model.number().default(0),

    // ── Rules ─────────────────────────────────────────────────────
    max_bids_per_bidder: model.number().nullable(),
    payment_window_hours: model.number().default(24),
    fulfilment_options: model.json().nullable(),
    return_policy_text: model.text().nullable(),
    warranty_text: model.text().nullable(),
    terms_version_id: model.text().nullable(),

    // Values come from auctionMachine in lib/state-machine/machines.
    status: model.text().default("draft"),
    cancellation_reason: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["reference"], unique: true },
    { on: ["status"] },
    { on: ["starts_at"] },
    { on: ["ends_at"] },
    { on: ["variant_id"] },
    { on: ["inventory_item_id"] },
  ])

export default Auction
