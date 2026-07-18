import { model } from "@medusajs/framework/utils"

// Ceedmart tax rule table. Every rule has a scope (general / collection / shop)
// and a rate. At tax calculation time the provider picks the highest-priority
// active rule that applies to each line item:
//   1. Shop rule for cart.sales_channel_id (highest priority)
//   2. Collection rule for item.product.collection_id
//   3. General rule (fallback)
//
// `is_tax_inclusive` decides whether the rate is baked into the item price or
// added on top at subtotal time.

const TaxOverride = model
  .define("TaxOverride", {
    id: model.id({ prefix: "taxovr" }).primaryKey(),
    name: model.text().searchable(),
    rate: model.number(), // percentage, e.g. 7.5
    is_tax_inclusive: model.boolean().default(false),
    scope: model.text(), // "general" | "collection" | "shop"
    // Null for scope=general; collection_id for scope=collection;
    // sales_channel_id for scope=shop.
    reference_id: model.text().nullable(),
    is_active: model.boolean().default(true),
  })
  .indexes([
    { on: ["scope"] },
    { on: ["reference_id"] },
    { on: ["is_active"] },
  ])

export default TaxOverride
