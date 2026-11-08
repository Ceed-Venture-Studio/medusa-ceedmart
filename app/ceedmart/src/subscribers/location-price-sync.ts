import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { syncLocationPricesWorkflow } from "../workflows/location-catalog/sync-location-prices"

// Keep variants' location prices in line with the product's.
//
// product-variant.created: a new variant inherits the product's location
// prices — the reason product-level prices are stored at all.
// product-variant.updated: the stock "Edit prices" grid rewrites a variant's
// whole price set and drops the province prices it does not know about;
// re-syncing restores them.
//
// The sync is convergent, so a redelivered or duplicate event is a no-op.

export default async function locationPriceSync({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id"],
    filters: { id: event.data.id },
  })
  const productId = (data as any[])[0]?.product_id
  if (!productId) return

  try {
    const { result } = await syncLocationPricesWorkflow(container).run({
      input: { product_ids: [productId] },
    })
    if (result.createdIds.length || result.removed.length) {
      logger.info(
        `[location-price-sync] ${productId}: +${result.createdIds.length} −${result.removed.length} (${event.name})`
      )
    }
  } catch (e: any) {
    logger.error(`[location-price-sync] ${productId} failed: ${e?.message ?? e}`)
  }
}

export const config: SubscriberConfig = {
  event: ["product-variant.created", "product-variant.updated"],
  context: { subscriberId: "location-price-sync" },
}
