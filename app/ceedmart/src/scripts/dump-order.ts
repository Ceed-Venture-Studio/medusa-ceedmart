import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

// Dump what query.graph returns for an order so I can see the shape of
// total / unit_price / quantity (bigNumber vs primitive).
// Usage: yarn medusa exec ./src/scripts/dump-order.ts <order_id>
export default async function dumpOrder({ container, args }: ExecArgs) {
  const orderId = args[0]
  if (!orderId) {
    console.log("Usage: yarn medusa exec ./src/scripts/dump-order.ts <order_id>")
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "display_id",
      "currency_code",
      "summary.*",
      "shipping_address.first_name",
      "*items",
      "items.title",
      "items.product_title",
      "items.variant_title",
      "items.unit_price",
      "items.detail.quantity",
    ],
    filters: { id: orderId },
  })

  console.log(JSON.stringify(data, null, 2))
}
