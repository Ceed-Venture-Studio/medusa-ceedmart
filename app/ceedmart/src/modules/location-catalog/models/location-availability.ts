import { model } from "@medusajs/framework/utils"

// Whether a product or variant may be bought in one state (lib/locations).
//
// Shown-but-unavailable, not hidden: the listing still carries the item,
// marked "Not available in <state>", and every cart path refuses it. Hiding
// a whole product from a city stays what it was — removing the product from
// that city's "Web – <city>" sales channel.
//
// No row means available, so nothing needs backfilling. A variant row beats
// a product row, the same precedence as listing policies.

const LocationAvailability = model
  .define("LocationAvailability", {
    id: model.id({ prefix: "lavl" }).primaryKey(),

    // Exactly one is set, enforced by a check constraint in the migration.
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    // ISO 3166-2, lower-case ("ng-la").
    province: model.text(),
    is_available: model.boolean().default(true),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["variant_id"] },
    { on: ["province"] },
  ])

export default LocationAvailability
