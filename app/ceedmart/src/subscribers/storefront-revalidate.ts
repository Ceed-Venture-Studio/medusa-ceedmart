import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

/**
 * Tells the storefront to drop its Next.js cache for global resources whenever
 * something the storefront caches changes in admin.
 *
 * Wiring:
 *   STOREFRONT_REVALIDATE_URL = https://<storefront>/api/revalidate
 *   REVALIDATE_SECRET         = <shared secret, also set on storefront>
 *
 * If either env var is missing the subscriber no-ops silently — useful in
 * dev where you don't have a storefront running.
 *
 * Tag mapping is conservative: each event group invalidates only the cache
 * tags it could plausibly affect, rather than nuking everything on every
 * change. Storefront's /api/revalidate route validates the tag against an
 * allow list, so unknown tags are rejected harmlessly.
 */

const EVENT_TAG_MAP: Record<string, string[]> = {
  // Products
  "product.created": ["products"],
  "product.updated": ["products"],
  "product.deleted": ["products"],
  "product-variant.created": ["products"],
  "product-variant.updated": ["products"],
  "product-variant.deleted": ["products"],

  // Categories
  "product-category.created": ["categories", "products"],
  "product-category.updated": ["categories", "products"],
  "product-category.deleted": ["categories", "products"],

  // Collections
  "product-collection.created": ["collections", "products"],
  "product-collection.updated": ["collections", "products"],
  "product-collection.deleted": ["collections", "products"],

  // Pricing changes — invalidate products so prices refresh
  "price-list.created": ["products"],
  "price-list.updated": ["products"],
  "price-list.deleted": ["products"],
  "price.created": ["products"],
  "price.updated": ["products"],
  "price.deleted": ["products"],

  // Regions
  "region.created": ["regions", "products"],
  "region.updated": ["regions", "products"],
  "region.deleted": ["regions", "products"],
}

export default async function storefrontRevalidate({
  event,
  container,
}: SubscriberArgs<unknown>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const url = process.env.STOREFRONT_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret) return

  const tags = EVENT_TAG_MAP[event.name]
  if (!tags?.length) return

  const params = new URLSearchParams()
  for (const t of tags) params.append("tag", t)

  try {
    const res = await fetch(`${url}?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (!res.ok) {
      logger.warn(
        `[storefront-revalidate] ${event.name} → ${res.status} ${res.statusText}`
      )
      return
    }
    logger.debug(
      `[storefront-revalidate] ${event.name} → revalidated [${tags.join(", ")}]`
    )
  } catch (err: any) {
    // Don't break the originating workflow if the storefront is unreachable.
    logger.warn(
      `[storefront-revalidate] ${event.name} fetch failed: ${err?.message ?? err}`
    )
  }
}

export const config: SubscriberConfig = {
  event: Object.keys(EVENT_TAG_MAP),
  context: { subscriberId: "storefront-revalidate" },
}
