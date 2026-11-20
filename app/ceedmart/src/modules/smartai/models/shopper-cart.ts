import { model } from "@medusajs/framework/utils"

// Which Medusa cart belongs to which SmartAI shopper.
//
// SmartAI sends an opaque shopper id with every manage_cart call; each
// shopper gets exactly one guest cart, and two shoppers never share one
// (docs/smartai-shopping-mcp-design.md §2.3). The row is created on the
// first ADD, never on VIEW, and repointed when its cart is completed or gone.

const ShopperCart = model
  .define("SmartaiShopperCart", {
    id: model.id({ prefix: "ssc" }).primaryKey(),
    shopper_id: model.text(),
    cart_id: model.text(),
  })
  .indexes([
    { on: ["shopper_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["cart_id"] },
  ])

export default ShopperCart
