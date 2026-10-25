import { linkProductsToSalesChannelWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { getWebSalesChannelIds } from "../lib/web-locations"
import { revalidateStorefront } from "../lib/storefront-revalidate"

// Every new product goes on sale in every web location.
//
// The storefront lists a product in a city only when it is linked to that
// city's "Web – <city>" channel. Nothing linked new products, so anything
// added in admin after the channels were set up was invisible — in search
// and on category pages — to every shopper who had picked a city. (Ayoola
// Beans Flour, 2026-10-25.)
//
// Opt-out rather than opt-in: to stop selling a product in one city, remove
// that channel from the product in admin. This only runs on creation, so an
// exclusion made later is never undone.
//
// Idempotent: channels the product is already in are skipped, so a
// redelivered product.created is a no-op.

export default async function webLocationAutoLink({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productId = event.data.id

  const webChannelIds = await getWebSalesChannelIds(container)
  if (!webChannelIds.length) return

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["sales_channel_id"],
    filters: { product_id: productId },
  })
  const linked = new Set((links as any[]).map((l) => l.sales_channel_id))
  const missing = webChannelIds.filter((id) => !linked.has(id))
  if (!missing.length) return

  for (const channelId of missing) {
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channelId, add: [productId] },
    })
  }
  logger.info(
    `[web-location-auto-link] ${productId} → ${missing.length} web channel(s)`
  )

  // storefront-revalidate also fires on product.created, but may run before
  // these links exist and let a city's listing be cached without the
  // product. Refresh again now that it is in every city.
  await revalidateStorefront(container, ["products"], "web-location-auto-link")
}

export const config: SubscriberConfig = {
  event: "product.created",
  context: { subscriberId: "web-location-auto-link" },
}
