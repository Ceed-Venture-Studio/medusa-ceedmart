import { model } from "@medusajs/framework/utils"

// A slot in a build — CPU, motherboard, RAM, GPU (BRD §7.3).
//
// Categories are data rather than an enum because the BRD wants "an
// architecture that can later support other configurable products" (§7.1).
// A server or a NAS has different slots; nothing here assumes a desktop PC.

const ComponentCategory = model
  .define({ name: "ComponentCategory", tableName: "build_component_category" }, {
    id: model.id({ prefix: "bcat" }).primaryKey(),
    code: model.text().unique(),
    label: model.text(),
    // Which build types this slot belongs to, by BuildType code. An array
    // rather than a single value because most slots are shared — storage
    // and the operating system apply to every kind of machine.
    //
    // Replaces an "desktop|laptop|both" enum that needed a migration to add
    // a third kind. `applies_to` is kept for the rows written before this
    // and is no longer read.
    build_types: model.json().nullable(),
    applies_to: model.text().default("desktop"),

    // ── What this slot's parts are described BY ───────────────────
    // The field definitions the admin form renders and a CSV import
    // validates against. Without it `attributes` is free-form JSON: the
    // form has nothing to draw and an import has nothing to check, so a
    // typo'd socket silently becomes a part that fits nothing.
    //
    // [{ key, label, type, unit?, required?, options?, help? }]
    //   type: "text" | "number" | "boolean" | "enum" | "list"
    //
    // The compatibility rules reference these keys, so the schema is also
    // the contract between the catalogue and the engine.
    attribute_schema: model.json().nullable(),
    // A build cannot be submitted without a choice in a required slot.
    // Cooling is required; a second monitor is not.
    is_required: model.boolean().default(true),
    // Some slots take several units — RAM sticks, storage drives, fans.
    allows_multiple: model.boolean().default(false),
    max_quantity: model.number().default(1),
    sort_order: model.number().default(0),
    help_text: model.text().nullable(),
  })
  .indexes([{ on: ["code"], unique: true }, { on: ["sort_order"] }])

export default ComponentCategory
