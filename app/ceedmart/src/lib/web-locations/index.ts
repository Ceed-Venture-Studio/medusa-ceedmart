import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Per-location web catalog.
//
// The storefront's location picker (Port Harcourt / Uyo / Lagos) maps to one
// sales channel per location. A product is sold in a location when it is
// linked to that location's channel, so taking an item off sale in Lagos is
// done in admin: Product → Sales channels → remove "Web – Lagos".
//
// These channels are for the website only. They are told apart from the
// POS shop channels by `metadata.ceedmart_web.location` (shop channels use
// `metadata.ceedmart.code`), so they never appear as pickup shops. Each one
// is linked to the same stock location(s) as the store's default channel,
// so stock is counted exactly as before. Carts stay on the default channel,
// which keeps checkout, shipping options and reservations unchanged.
//
// The ids match DELIVERY_LOCATIONS in the storefront
// (src/lib/data/delivery-locations.ts) — the picker's cookie value.

export const WEB_LOCATION_METADATA_KEY = "ceedmart_web"

export const WEB_LOCATIONS = [
  { id: "port-harcourt", name: "Port Harcourt" },
  { id: "uyo", name: "Uyo" },
  { id: "lagos", name: "Lagos" },
] as const

export type WebLocationId = (typeof WEB_LOCATIONS)[number]["id"]

export const webLocationOf = (salesChannel: {
  metadata?: Record<string, any> | null
}): string | null =>
  salesChannel.metadata?.[WEB_LOCATION_METADATA_KEY]?.location ?? null

export const getDefaultSalesChannelId = async (
  container: MedusaContainer
): Promise<string | null> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  })
  return (stores as any[])[0]?.default_sales_channel_id ?? null
}

/**
 * The one sales channel a store route should scope to.
 *
 * Routes used to take the publishable key's first channel. Once the
 * storefront's key also carries the per-location web channels, "first" is
 * no longer predictable, so prefer the store's default channel whenever the
 * key includes it, and fall back to the key's first channel otherwise (the
 * POS keys, which carry exactly one shop channel).
 */
export const resolveStoreSalesChannelId = async (
  req: { scope: MedusaContainer } & Record<string, any>
): Promise<string | null> => {
  const ids: string[] = req.publishable_key_context?.sales_channel_ids ?? []
  if (ids.length <= 1) {
    return ids[0] ?? null
  }

  const defaultId = await getDefaultSalesChannelId(req.scope)
  return defaultId && ids.includes(defaultId) ? defaultId : ids[0]
}
