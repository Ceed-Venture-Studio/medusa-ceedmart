import { model } from "@medusajs/framework/utils"

// Where a pre-order is sourced from (BRD §6.4 "source country,
// supplier/source reference").
//
// Kept as its own table rather than free text on the offer so procurement
// can report on supplier reliability — which supplier's items actually
// arrive inside the promised window is the number that decides whether the
// estimate is honest.

const SourceSupplier = model
  .define("SourceSupplier", {
    id: model.id({ prefix: "psup" }).primaryKey(),
    name: model.text().searchable(),
    country_code: model.text().default("us"),
    // Storefront, marketplace or distributor reference — internal only.
    reference: model.text().nullable(),
    contact_email: model.text().nullable(),
    contact_phone: model.text().nullable(),
    notes: model.text().nullable(),
    is_active: model.boolean().default(true),
  })
  .indexes([{ on: ["is_active"] }, { on: ["country_code"] }])

export default SourceSupplier
