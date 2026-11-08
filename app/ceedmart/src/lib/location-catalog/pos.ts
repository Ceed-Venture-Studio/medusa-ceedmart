import type { MedusaContainer } from "@medusajs/framework/types"
import { QueryContext } from "@medusajs/framework/utils"
import { LOCATION_CATALOG_MODULE } from "../../modules/location-catalog"
import { PROVINCE_ATTRIBUTE, resolveSalesChannelProvince } from "../locations"
import { loadAvailability } from "./runtime"

// The PoS reads its catalog from the /pos endpoints, not /store, so those
// price for the shop's state and mark availability here. A shop channel's
// state comes from its metadata.ceedmart.state (lib/locations).

/** calculated_price context for a shop: national, plus the shop's state. */
export const posPriceContext = async (
  container: MedusaContainer,
  salesChannelId: string,
  regionId: string
) => {
  const province = await resolveSalesChannelProvince(container, salesChannelId)
  return {
    calculated_price: QueryContext({
      region_id: regionId,
      currency_code: "ngn",
      ...(province ? { [PROVINCE_ATTRIBUTE]: province } : {}),
    }),
  }
}

/**
 * Mark each variant `available_here` for the shop's state. Variants need
 * their product id, passed alongside since the PoS field sets omit it.
 */
export const annotatePosAvailability = async (
  container: MedusaContainer,
  salesChannelId: string,
  entries: { variant: any; productId: string }[]
) => {
  const province = await resolveSalesChannelProvince(container, salesChannelId)
  if (!province || !entries.length) return
  const availability = await loadAvailability(
    container,
    entries.map((e) => ({ variantId: e.variant.id, productId: e.productId })),
    province
  )
  for (const e of entries) {
    e.variant.available_here = availability.get(e.variant.id) !== false
  }
}

/**
 * Products whose location prices or availability changed since `since`.
 *
 * An incremental PoS sync only re-sends products that changed, and neither
 * clearing a location price nor changing availability touches the product
 * or leaves a newer price row behind. Saving always soft-deletes the old
 * rows and creates new ones, so created or deleted since the cursor covers
 * every change.
 */
export const locationCatalogChangedProductIds = async (
  container: MedusaContainer,
  since: Date
): Promise<string[]> => {
  const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)
  const changed = {
    $or: [{ created_at: { $gt: since } }, { deleted_at: { $gt: since } }],
  }
  const opts = { select: ["product_id", "variant_id"], withDeleted: true, take: 10_000 }
  const [prices, availability] = await Promise.all([
    catalog.listLocationPrices(changed, opts),
    catalog.listLocationAvailabilities(changed, opts),
  ])
  const rows = [...prices, ...availability] as any[]
  const productIds = new Set<string>(rows.map((r) => r.product_id).filter(Boolean))
  const variantIds = rows.map((r) => r.variant_id).filter(Boolean)
  if (variantIds.length) {
    const query = container.resolve("query") as any
    const { data } = await query.graph({
      entity: "variant",
      fields: ["product_id"],
      filters: { id: variantIds },
      withDeleted: true,
    })
    for (const v of data as any[]) if (v.product_id) productIds.add(v.product_id)
  }
  return [...productIds]
}
