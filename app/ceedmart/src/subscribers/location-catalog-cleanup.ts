import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { LOCATION_CATALOG_MODULE } from "../modules/location-catalog"

// Drop location rows for a deleted product or variant. The prices they
// produced go with the variant's price set; these are the authoring rows,
// which would otherwise outlive what they describe.

export default async function locationCatalogCleanup({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)
  const filter =
    event.name === "product.deleted"
      ? { product_id: event.data.id }
      : { variant_id: event.data.id }

  const [prices, availability] = await Promise.all([
    catalog.listLocationPrices(filter, { select: ["id"] }),
    catalog.listLocationAvailabilities(filter, { select: ["id"] }),
  ])
  if (prices.length) await catalog.softDeleteLocationPrices(prices.map((r: any) => r.id))
  if (availability.length)
    await catalog.softDeleteLocationAvailabilities(availability.map((r: any) => r.id))
}

export const config: SubscriberConfig = {
  event: ["product.deleted", "product-variant.deleted"],
  context: { subscriberId: "location-catalog-cleanup" },
}
