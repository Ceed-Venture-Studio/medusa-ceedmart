import { model } from "@medusajs/framework/utils"

// A part a customer can pick (BRD §7.3, §7.4).
//
// §7.4 is emphatic that the interface "must not imply that a soldered or
// manufacturer-fixed laptop component can be changed" and that "options are
// driven by actual purchasable variants or services". So an option points at
// a real Medusa variant wherever one exists, and `is_fixed` marks a part
// that ships with a chosen model and cannot be swapped.
//
// `attributes` carries the facts the compatibility engine reasons over —
// socket, chipset, memory type, form factor, wattage, dimensions. Kept as
// JSON rather than columns because each category needs different facts and
// a column per attribute across every category would be mostly nulls.

const ComponentOption = model
  .define("ComponentOption", {
    id: model.id({ prefix: "bopt" }).primaryKey(),
    category_id: model.text(),

    label: model.text().searchable(),
    brand: model.text().nullable(),
    // The purchasable variant. Null for a service line (assembly, setup) or
    // a part we quote but do not stock.
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),

    // Kobo. Snapshot for the estimate only — the binding number comes from
    // the quote a specialist issues (§7.9).
    indicative_price: model.bigNumber().nullable(),
    currency_code: model.text().default("ngn"),

    // { socket, chipset, memory_type, memory_speed, form_factor, tdp,
    //   wattage, length_mm, height_mm, pcie_version, interface, m2_slots, … }
    attributes: model.json().nullable(),

    // True when the part is soldered or otherwise fixed to a chosen model,
    // so the UI shows it without an option to change it (§7.4).
    is_fixed: model.boolean().default(false),
    // Only offered when this model family is selected — laptop options are
    // scoped to the machine they belong to.
    model_family: model.text().nullable(),

    is_active: model.boolean().default(true),
    sort_order: model.number().default(0),
  })
  .indexes([
    { on: ["category_id"] },
    { on: ["variant_id"] },
    { on: ["is_active"] },
    { on: ["model_family"] },
  ])

export default ComponentOption
