import { model } from "@medusajs/framework/utils"

// One pre-ordered line, tracked from payment to delivery (BRD §6.4).
//
// Created when a cart containing a pre-order offer completes. Everything
// commercially meaningful is SNAPSHOTTED here rather than read back from
// the offer: §5.3 requires historical totals not to change when catalogue
// prices or exchange rates change, and §6.6 requires a paid order to record
// an immutable price, exchange-rate snapshot, promised date and terms
// version.
//
// So the offer is a template. This row is the contract.

const PreorderOrder = model
  .define("PreorderOrder", {
    id: model.id({ prefix: "preo" }).primaryKey(),

    order_id: model.text(),
    order_display_id: model.number().nullable(),
    line_item_id: model.text().nullable(),
    offer_id: model.text(),
    variant_id: model.text().nullable(),
    quantity: model.number().default(1),

    // ── Frozen commercials ────────────────────────────────────────
    // Unit price in kobo at the moment of payment. Never recomputed.
    unit_price: model.bigNumber(),
    currency_code: model.text().default("ngn"),
    // The offer's cost_components as they stood — the landed-cost snapshot
    // (§10.2). Stored inline rather than in its own table: it is written
    // once and only ever read alongside this row, so a join would buy
    // nothing and a second table would be one more thing to keep immutable.
    cost_snapshot: model.json().nullable(),
    fx_rate: model.number().nullable(),

    // ── Frozen promise ────────────────────────────────────────────
    // What the customer was told, and when the clock started. §6.2: the
    // window runs from payment plus sourcing confirmation, and PAUSES while
    // we wait on a customer approval — paused_days accumulates that time so
    // promised_delivery_date can be recomputed honestly rather than quietly
    // slipping.
    promised_delivery_date: model.dateTime().nullable(),
    estimate_days: model.number().nullable(),
    clock_started_at: model.dateTime().nullable(),
    paused_at: model.dateTime().nullable(),
    paused_days: model.number().default(0),

    // Terms the customer accepted, per §6.6.
    terms_version_id: model.text().nullable(),

    // ── Lifecycle ─────────────────────────────────────────────────
    // Values come from preorderMachine in lib/state-machine/machines.
    status: model.text().default("awaiting_payment"),
    // Set when the row enters an exception state, so ops can filter a queue
    // without parsing audit history (§6.5 exception queue).
    exception_reason: model.text().nullable(),
    exception_at: model.dateTime().nullable(),

    // Latest known logistics detail. Full history lives in
    // preorder_milestone.
    carrier: model.text().nullable(),
    tracking_reference: model.text().nullable(),
    tracking_url: model.text().nullable(),

    // Item facts as disclosed at purchase — so a later edit to the offer
    // cannot rewrite what the customer was promised.
    condition: model.text().nullable(),
    warranty_text: model.text().nullable(),
    return_policy_text: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["order_id"] },
    { on: ["offer_id"] },
    { on: ["status"] },
    { on: ["promised_delivery_date"] },
    { on: ["exception_at"] },
  ])

export default PreorderOrder
