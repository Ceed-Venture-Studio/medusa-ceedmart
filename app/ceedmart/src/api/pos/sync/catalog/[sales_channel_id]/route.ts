import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  getVariantAvailability,
  MedusaError,
  QueryContext,
} from "@medusajs/framework/utils"

// Delta sync for the offline POS catalog cache.
//
// Two modes:
//
//   Initial sync (first device boot, or local cache wiped):
//     GET /pos/sync/catalog/:scid?offset=N&limit=500
//     Client paginates from offset=0 until has_more=false, persists each page,
//     then records server_time as last_synced_at.
//
//   Incremental sync (subsequent polls):
//     GET /pos/sync/catalog/:scid?since=ISO
//     Returns only products whose updated_at > since. Typically small, fits
//     in one response — but the response still respects ?limit and includes
//     has_more, so a one-shot incremental that hits the page cap can be
//     drained with ?since=... combined with ?offset=... follow-ups.
//
// Soft-deleted product ids are returned in deleted_ids so the client can
// drop them from its local cache.

const POS_SYNC_FIELDS = [
  "id",
  "title",
  "subtitle",
  "handle",
  "thumbnail",
  "status",
  "updated_at",
  "categories.id",
  "categories.name",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.barcode",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "variants.updated_at",
]

const MAX_PAGE = 500

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { sales_channel_id } = req.params
  const since = req.query.since as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 500), MAX_PAGE)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
    filters: { currency_code: "ngn" },
  })
  const ngnRegion = regions[0]
  if (!ngnRegion) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Nigeria region (NGN) is not configured"
    )
  }
  const priceContext = {
    calculated_price: QueryContext({
      region_id: ngnRegion.id,
      currency_code: "ngn",
    }),
  }

  // Limit to products in the requested sales channel.
  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id },
    pagination: { skip: 0, take: 10_000 },
  })
  const channelProductIds = links.map((l: any) => l.product_id)
  const serverTime = new Date().toISOString()
  if (!channelProductIds.length) {
    return res.json({
      products: [],
      deleted_ids: [],
      server_time: serverTime,
      has_more: false,
      count: 0,
    })
  }

  const filters: Record<string, any> = {
    status: "published",
    id: channelProductIds,
  }
  if (since) {
    filters.updated_at = { $gt: new Date(since) }
  }

  // Stable ordering by (updated_at, id) so offset pagination doesn't reshuffle
  // results mid-drain. Tiebreaker on id is critical when many products share
  // an updated_at (seed/bulk imports).
  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: POS_SYNC_FIELDS,
    filters,
    pagination: {
      take: limit,
      skip: offset,
      order: { updated_at: "ASC", id: "ASC" },
    },
  })

  // Enrich variants with calculated_price (separate query — pricing context
  // doesn't propagate through nested product.variants graph fields).
  const allVariants = (products as any[]).flatMap((p) => p.variants ?? [])
  const variantIds = allVariants.map((v: any) => v.id)
  if (variantIds.length) {
    const { data: priced } = await query.graph({
      entity: "variant",
      fields: ["id", "calculated_price.*"],
      filters: { id: variantIds },
      context: priceContext,
    })
    const priceById = new Map(priced.map((v: any) => [v.id, v.calculated_price]))
    for (const v of allVariants) {
      ;(v as any).calculated_price = priceById.get(v.id) ?? null
    }
  }

  // Inventory snapshot for variants that manage inventory.
  const managedIds = allVariants
    .filter((v: any) => v.manage_inventory)
    .map((v: any) => v.id)
  if (managedIds.length) {
    const availability = await getVariantAvailability(query, {
      variant_ids: managedIds,
      sales_channel_id,
    })
    for (const v of allVariants) {
      if (v.manage_inventory) {
        ;(v as any).inventory_quantity = availability[v.id]?.availability ?? 0
      }
    }
  }

  // Soft-deleted products since the cursor — separate query because the main
  // one filters them out implicitly. Only relevant in incremental mode.
  let deleted_ids: string[] = []
  if (since) {
    const { data: deleted } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: {
        id: channelProductIds,
        deleted_at: { $gt: new Date(since) },
      },
      withDeleted: true,
      pagination: { take: 10_000, skip: 0 },
    } as any).catch(() => ({ data: [] as any[] }))
    deleted_ids = deleted.map((p: any) => p.id)
  }

  res.json({
    products,
    deleted_ids,
    server_time: serverTime,
    has_more: products.length === limit,
    count: metadata?.count ?? products.length,
    next_offset: offset + products.length,
  })
}
