import { model } from "@medusajs/framework/utils"

// What a product or variant costs in one state (lib/locations).
//
// ── Authoring record, not the price the shop charges ────────────────────
// Medusa's pricing engine is what prices carts and listings. These rows are
// what admin edits; lib/location-catalog/sync-prices turns them into
// ordinary variant prices carrying a `province` rule, so price lists,
// currency handling and the engine's own indexes all keep working.
//
// A product row is the default for every variant of the product, including
// variants added later; a variant row overrides it. That inheritance is why
// the authoring copy has to exist at all: Medusa stores prices per variant
// only, so "the product's Lagos price" has nowhere else to live.

const LocationPrice = model
  .define("LocationPrice", {
    id: model.id({ prefix: "lprc" }).primaryKey(),

    // Exactly one is set, enforced by a check constraint in the migration.
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    // ISO 3166-2, lower-case ("ng-la").
    province: model.text(),
    currency_code: model.text(),
    amount: model.bigNumber(),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["variant_id"] },
    { on: ["province"] },
  ])

export default LocationPrice
