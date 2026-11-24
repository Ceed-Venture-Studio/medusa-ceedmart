import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  getVariantAvailability,
  QueryContext,
} from "@medusajs/framework/utils"
import { resolvePoliciesForVariants } from "../listing-policy"
import { loadAvailability } from "../location-catalog/runtime"
import { PROVINCE_ATTRIBUTE, provinceName } from "../locations"
import { getDefaultSalesChannelId, WEB_LOCATIONS, webLocationOf } from "../web-locations"
import { num, type CatalogProduct, type CategoryRow } from "./shape"

// Container-facing side of the SmartAI shopping tools: where the assistant
// shops, and the catalogue as that place sees it. The rules are in ./shape.

export const smartaiConfig = () => ({
  location: (process.env.SMARTAI_DEFAULT_LOCATION || "port-harcourt").trim(),
  recommendTag: (process.env.SMARTAI_RECOMMEND_TAG || "Featured").trim(),
  maxQuantity: Math.max(1, Number(process.env.SMARTAI_MAX_QUANTITY) || 20),
  // Product pages and the checkout link. SMARTAI_STOREFRONT_URL wins where
  // STOREFRONT_URL is not a public site (staging has no storefront of its own).
  storefrontUrl:
    (process.env.SMARTAI_STOREFRONT_URL || process.env.STOREFRONT_URL || "").replace(/\/$/, "") || null,
})

export type ShopLocation = {
  /** ISO 3166-2, e.g. "ng-ri" — prices and availability key on it. */
  province: string
  stateName: string
  /** The city's web channel: which products are listed there. */
  cityChannelId: string
  /** Carts always sit on the default channel (lib/web-locations). */
  defaultChannelId: string
  regionId: string
}

let cached: { at: number; value: ShopLocation } | null = null
const LOCATION_TTL_MS = 5 * 60_000

/** The one location every tool call shops in (SMARTAI_DEFAULT_LOCATION). */
export const getShopLocation = async (container: MedusaContainer): Promise<ShopLocation> => {
  if (cached && Date.now() - cached.at < LOCATION_TTL_MS) return cached.value

  const { location } = smartaiConfig()
  const web = WEB_LOCATIONS.find((l) => l.id === location)
  if (!web) {
    throw new Error(
      `SMARTAI_DEFAULT_LOCATION "${location}" is not one of ${WEB_LOCATIONS.map((l) => l.id).join(", ")}`
    )
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: channels }, { data: regions }, defaultChannelId] = await Promise.all([
    query.graph({ entity: "sales_channel", fields: ["id", "metadata"], pagination: { skip: 0, take: 1000 } }),
    query.graph({ entity: "region", fields: ["id"], filters: { currency_code: "ngn" } }),
    getDefaultSalesChannelId(container),
  ])
  if (!defaultChannelId) throw new Error("The store has no default sales channel")
  const regionId = (regions as any[])[0]?.id
  if (!regionId) throw new Error("No NGN region")
  // Before the city channels were set up, the default channel listed everything.
  const city = (channels as any[]).find((c) => webLocationOf(c) === location)

  const value: ShopLocation = {
    province: web.province,
    stateName: provinceName(web.province) ?? web.name,
    cityChannelId: city?.id ?? defaultChannelId,
    defaultChannelId,
    regionId,
  }
  cached = { at: Date.now(), value }
  return value
}

/** Ids of products listed in the location's city channel. */
export const channelProductIds = async (container: MedusaContainer, loc: ShopLocation): Promise<string[]> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id: loc.cityChannelId },
    pagination: { skip: 0, take: 20_000 },
  })
  return (data as any[]).map((l) => l.product_id)
}

export const listCategories = async (container: MedusaContainer): Promise<CategoryRow[]> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "mpath", "is_active", "is_internal"],
    pagination: { skip: 0, take: 2_000 },
  })
  return (data as any[])
    .filter((c) => c.is_active !== false && c.is_internal !== true)
    .map((c) => ({ id: c.id, name: c.name, mpath: c.mpath ?? null }))
}

export const productIdsInCategories = async (container: MedusaContainer, categoryIds: string[]) => {
  if (!categoryIds.length) return new Set<string>()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "products.id"],
    filters: { id: categoryIds },
  })
  return new Set<string>((data as any[]).flatMap((c) => (c.products ?? []).map((p: any) => p.id)))
}

/** Published products among `ids`, newest first. */
export const newestProductIds = async (container: MedusaContainer, ids: string[], take = 60) => {
  if (!ids.length) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: ids, status: "published" },
    pagination: { skip: 0, take, order: { created_at: "DESC" } },
  })
  return (data as any[]).map((p) => p.id)
}

export const taggedProductIds = async (container: MedusaContainer, tagValue: string) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_tag",
    fields: ["id", "value", "products.id"],
    filters: { value: tagValue },
  })
  return new Set<string>((data as any[]).flatMap((t) => (t.products ?? []).map((p: any) => p.id)))
}

/** Published products among `ids` whose searchable text contains `word`. */
export const productIdsMatching = async (container: MedusaContainer, ids: string[], word: string) => {
  if (!ids.length) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: ids, status: "published", q: word } as any,
    pagination: { skip: 0, take: 500 },
  })
  return (data as any[]).map((p) => p.id)
}

/** Units sold per product in the last 90 days, for the "popular" sort. */
export const unitsSold = async (container: MedusaContainer, productIds: string[]) => {
  const out = new Map<string, number>()
  if (!productIds.length) return out
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const rows = await knex.raw(
    `select li.product_id, sum(oi.quantity)::float as units
       from order_line_item li
       join order_item oi on oi.item_id = li.id and oi.deleted_at is null
       join "order" o on o.id = oi.order_id and o.version = oi.version
      where o.deleted_at is null
        and o.status <> 'canceled'
        and o.created_at > now() - interval '90 days'
        and li.product_id = any(?)
      group by li.product_id`,
    [productIds]
  )
  for (const r of rows.rows ?? []) out.set(r.product_id, Number(r.units) || 0)
  return out
}

/**
 * Products as the location sees them, in the order of `productIds`: state
 * price, availability in the state, stock for the city channel, and listing
 * type per variant. Unpublished or unknown ids are left out.
 */
export const loadCatalog = async (
  container: MedusaContainer,
  loc: ShopLocation,
  productIds: string[]
): Promise<CatalogProduct[]> => {
  const ids = [...new Set(productIds)]
  if (!ids.length) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      "description",
      "status",
      "categories.name",
      "options.id",
      "options.title",
      "variants.id",
      "variants.manage_inventory",
      "variants.allow_backorder",
      "variants.options.value",
      "variants.options.option_id",
    ],
    filters: { id: ids, status: "published" },
  })
  const rows = products as any[]
  const variantIds = rows.flatMap((p) => (p.variants ?? []).map((v: any) => v.id))
  if (!variantIds.length) return []

  const targets = rows.flatMap((p) =>
    (p.variants ?? []).map((v: any) => ({ variantId: v.id, productId: p.id }))
  )
  const managed = rows.flatMap((p) =>
    (p.variants ?? []).filter((v: any) => v.manage_inventory).map((v: any) => v.id)
  )

  const [{ data: priced }, here, stock, policies] = await Promise.all([
    query.graph({
      entity: "variant",
      fields: ["id", "calculated_price.calculated_amount"],
      filters: { id: variantIds },
      context: {
        calculated_price: QueryContext({
          region_id: loc.regionId,
          currency_code: "ngn",
          [PROVINCE_ATTRIBUTE]: loc.province,
        }),
      },
    }),
    loadAvailability(container, targets, loc.province),
    managed.length
      ? getVariantAvailability(query, { variant_ids: managed, sales_channel_id: loc.cityChannelId })
      : Promise.resolve({} as Record<string, { availability: number | null }>),
    resolvePoliciesForVariants(container, targets),
  ])
  const priceOf = new Map<string, number | null>(
    (priced as any[]).map((v) => {
      const amount = v.calculated_price?.calculated_amount
      return [v.id, amount == null ? null : num(amount)]
    })
  )

  const byId = new Map(rows.map((p) => [p.id, p]))
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p: any) => {
      // Option order by title: the options list comes back in no fixed
      // order, and a size label must read the same on every call.
      const optionOrder = new Map<string, number>(
        [...(p.options ?? [])]
          .sort((a: any, b: any) => String(a.title ?? "").localeCompare(String(b.title ?? "")) || String(a.id).localeCompare(String(b.id)))
          .map((o: any, i: number) => [o.id, i])
      )
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: p.thumbnail ?? null,
        description: p.description ?? null,
        category: p.categories?.[0]?.name ?? null,
        variants: (p.variants ?? []).map((v: any) => {
          const policy = policies.get(v.id)
          return {
            id: v.id,
            manage_inventory: !!v.manage_inventory,
            allow_backorder: !!v.allow_backorder,
            option_values: [...(v.options ?? [])]
              .sort(
                (a: any, b: any) =>
                  (optionOrder.get(a.option_id) ?? 0) - (optionOrder.get(b.option_id) ?? 0)
              )
              .map((o: any) => String(o.value ?? "")),
            price: priceOf.get(v.id) ?? null,
            stock: (stock as any)[v.id]?.availability ?? null,
            available_here: here.get(v.id) !== false,
            commerce_type: policy?.commerceType ?? "standard",
            policy_active: policy?.isActive !== false,
          }
        }),
      }
    })
}
