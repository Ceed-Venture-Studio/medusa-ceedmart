import {
  ContainerRegistrationKeys,
  getVariantAvailability,
} from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

// One-shot diagnostic: print inventory_quantity that the POS sync route
// would emit for a given variant. Usage:
//   yarn medusa exec ./src/scripts/check-inventory.ts <variant_id> <sales_channel_id>
export default async function checkInventory({ container, args }: ExecArgs) {
  const variantId = args[0]
  const salesChannelId = args[1]

  if (!variantId || !salesChannelId) {
    console.log(
      "Usage: yarn medusa exec ./src/scripts/check-inventory.ts <variant_id> <sales_channel_id>"
    )
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  console.log(`\nChecking variant=${variantId} channel=${salesChannelId}\n`)

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "title", "manage_inventory", "allow_backorder"],
    filters: { id: [variantId] },
  })
  console.log("variant row:", variants[0])

  const { data: links } = await query.graph({
    entity: "product_variant_inventory_items",
    fields: [
      "variant_id",
      "required_quantity",
      "inventory.id",
      "inventory.location_levels.location_id",
      "inventory.location_levels.stocked_quantity",
      "inventory.location_levels.reserved_quantity",
      "inventory.location_levels.available_quantity",
    ],
    filters: { variant_id: variantId },
  })
  console.log("\npvii rows:", JSON.stringify(links, null, 2))

  const { data: channelLocs } = await query.graph({
    entity: "sales_channel_locations",
    fields: ["stock_location_id"],
    filters: { sales_channel_id: salesChannelId },
  })
  console.log("\nchannel stock locations:", channelLocs)

  const availability = await getVariantAvailability(query as any, {
    variant_ids: [variantId],
    sales_channel_id: salesChannelId,
  })
  console.log("\ngetVariantAvailability result:", availability)
  console.log(
    `\n=> inventory_quantity that POS sync would emit: ${
      availability[variantId]?.availability ?? 0
    }`
  )
}
