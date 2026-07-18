import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

// Simulates the incremental-mode product filter built by
// /pos/sync/catalog/:scid in src/api/pos/sync/catalog/[sales_channel_id]/route.ts.
// Confirms my fix actually picks up products whose inventory_level was
// changed since `since`, even if product.updated_at is older.
//
// Usage: yarn medusa exec ./src/scripts/test-incremental-sync.ts <sales_channel_id> <since_iso>
export default async function testIncrementalSync({ container, args }: ExecArgs) {
  const salesChannelId = args[0]
  const since = args[1]

  if (!salesChannelId || !since) {
    console.log(
      "Usage: yarn medusa exec ./src/scripts/test-incremental-sync.ts <sales_channel_id> <since_iso>"
    )
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const sinceDate = new Date(since)

  console.log(`Channel: ${salesChannelId}`)
  console.log(`Since:   ${sinceDate.toISOString()}\n`)

  // Step 1: products in this channel.
  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id: salesChannelId },
    pagination: { skip: 0, take: 10_000 },
  })
  const channelProductIds = links.map((l: any) => l.product_id)
  console.log(`Channel has ${channelProductIds.length} products`)

  // Step 2: products updated since (original behavior).
  const { data: productUpdated } = await query.graph({
    entity: "product",
    fields: ["id", "title", "updated_at"],
    filters: {
      status: "published",
      id: channelProductIds,
      updated_at: { $gt: sinceDate },
    },
    pagination: { skip: 0, take: 1000 },
  })
  console.log(`\nproduct.updated_at > since: ${productUpdated.length}`)
  for (const p of productUpdated.slice(0, 5)) {
    console.log(`  - ${p.id} ${p.title}`)
  }

  // Step 3: inventory_level changes since — MY FIX'S extra logic.
  const { data: changedLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id", "updated_at"],
    filters: { updated_at: { $gt: sinceDate } },
    pagination: { take: 10_000, skip: 0 },
  })
  console.log(`\ninventory_level.updated_at > since: ${changedLevels.length}`)

  const changedItemIds = Array.from(
    new Set((changedLevels as any[]).map((l) => l.inventory_item_id))
  )

  let inventoryChangedProductIds: string[] = []
  if (changedItemIds.length) {
    const { data: variantLinks } = await query.graph({
      entity: "product_variant_inventory_item",
      fields: ["variant_id"],
      filters: { inventory_item_id: changedItemIds },
      pagination: { take: 10_000, skip: 0 },
    })
    const variantIdsForInventory = Array.from(
      new Set((variantLinks as any[]).map((l) => l.variant_id))
    )
    if (variantIdsForInventory.length) {
      const { data: variantOwners } = await query.graph({
        entity: "variant",
        fields: ["id", "product_id"],
        filters: { id: variantIdsForInventory },
        pagination: { take: 10_000, skip: 0 },
      })
      inventoryChangedProductIds = Array.from(
        new Set((variantOwners as any[]).map((v) => v.product_id))
      ).filter((pid) => channelProductIds.includes(pid))
    }
  }

  console.log(
    `\nproducts whose inventory changed in channel: ${inventoryChangedProductIds.length}`
  )

  if (inventoryChangedProductIds.length) {
    const { data: productsForInv } = await query.graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: inventoryChangedProductIds },
    })
    for (const p of productsForInv.slice(0, 10)) {
      console.log(`  - ${p.id} ${p.title}`)
    }
  }

  // Step 4: union (what the fixed sync endpoint returns).
  const unionIds = new Set([
    ...productUpdated.map((p: any) => p.id),
    ...inventoryChangedProductIds,
  ])
  console.log(`\n=== sync would return ${unionIds.size} products total ===`)
}
