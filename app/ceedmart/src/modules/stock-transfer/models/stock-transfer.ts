import { model } from "@medusajs/framework/utils"

// One row per inventory movement between stock locations. M1 populates
// these on order placement when the fulfilling location can't cover the
// order and the shop's `sourcing_priority` list has a location that can.
// Cached name / product / sku fields let the admin list render with no
// extra queries even after a location or product is renamed later.

const StockTransfer = model
  .define("StockTransfer", {
    id: model.id({ prefix: "stx" }).primaryKey(),

    // Source and target locations for this pull.
    from_location_id: model.text(),
    to_location_id: model.text(),
    from_location_name: model.text().nullable(),
    to_location_name: model.text().nullable(),

    // What moved.
    inventory_item_id: model.text(),
    variant_id: model.text().nullable(),
    variant_sku: model.text().nullable(),
    product_title: model.text().nullable(),
    quantity: model.number(),

    // Order that triggered the pull. Nullable so we can later add manual
    // admin-initiated transfers without a schema change.
    order_id: model.text().nullable(),
    order_display_id: model.number().nullable(),

    // "auto_pull_on_order" for now; kept for future extension.
    reason: model.text().default("auto_pull_on_order"),
    // "completed" for now; kept for future "requested"/"in_transit" states.
    status: model.text().default("completed"),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["order_id"] },
    { on: ["from_location_id"] },
    { on: ["to_location_id"] },
    { on: ["created_at"] },
  ])

export default StockTransfer
