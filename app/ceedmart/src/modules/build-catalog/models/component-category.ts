import { model } from "@medusajs/framework/utils"

// A slot in a build — CPU, motherboard, RAM, GPU (BRD §7.3).
//
// Categories are data rather than an enum because the BRD wants "an
// architecture that can later support other configurable products" (§7.1).
// A server or a NAS has different slots; nothing here assumes a desktop PC.

const ComponentCategory = model
  .define("ComponentCategory", {
    id: model.id({ prefix: "bcat" }).primaryKey(),
    code: model.text().unique(),
    label: model.text(),
    // "desktop" | "laptop" | "both"
    applies_to: model.text().default("desktop"),
    // A build cannot be submitted without a choice in a required slot.
    // Cooling is required; a second monitor is not.
    is_required: model.boolean().default(true),
    // Some slots take several units — RAM sticks, storage drives, fans.
    allows_multiple: model.boolean().default(false),
    max_quantity: model.number().default(1),
    sort_order: model.number().default(0),
    help_text: model.text().nullable(),
  })
  .indexes([{ on: ["code"], unique: true }, { on: ["applies_to"] }, { on: ["sort_order"] }])

export default ComponentCategory
