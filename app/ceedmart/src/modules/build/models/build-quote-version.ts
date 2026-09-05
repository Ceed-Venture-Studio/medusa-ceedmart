import { model } from "@medusajs/framework/utils"

// One immutable revision of a quote (BRD §7.6).
//
// Append-only. A revision is a new row, never an edit — §7.6 is explicit
// that changes must not overwrite prior versions, and §7.9 that estimates
// are not binding until an authorised quote is accepted. If a customer
// accepted v2 and a specialist later issues v3, v2 is still exactly what
// they agreed to.
//
// Line items are stored as JSON rather than child rows: a version is
// written once and always read whole, so a join would buy nothing and give
// something else a chance to mutate.

const BuildQuoteVersion = model
  .define("BuildQuoteVersion", {
    id: model.id({ prefix: "bldqv" }).primaryKey(),
    quote_id: model.text(),
    // Monotonic per quote, starting at 1.
    version: model.number(),

    // [{ label, description, category, quantity, unit_price, variant_id? }]
    // variant_id is optional because a specialist may quote a part we do
    // not carry as a catalogue variant yet.
    line_items: model.json(),
    // Assembly, software setup, data transfer, testing (§7.3).
    service_items: model.json().nullable(),

    // ── Money, kobo ───────────────────────────────────────────────
    subtotal: model.bigNumber(),
    discount_total: model.bigNumber().default(0),
    tax_total: model.bigNumber().default(0),
    delivery_total: model.bigNumber().default(0),
    total: model.bigNumber(),
    currency_code: model.text().default("ngn"),

    // ── Commitments ───────────────────────────────────────────────
    build_days: model.number().nullable(),
    warranty_text: model.text().nullable(),
    // §7.9 — a quote must specify whether ownership of procured components
    // prevents cancellation after a milestone.
    cancellation_terms: model.text().nullable(),
    // §7.6 — quotes expire. An indefinitely valid quote is a standing offer
    // at last quarter's component prices.
    valid_until: model.dateTime(),

    // Why this version differs from the last, shown to the customer.
    change_note: model.text().nullable(),
    prepared_by: model.text().nullable(),
    sent_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["quote_id"] },
    { on: ["quote_id", "version"], unique: true },
    { on: ["valid_until"] },
  ])

export default BuildQuoteVersion
