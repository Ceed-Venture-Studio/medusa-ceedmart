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

const POS_PRODUCT_FIELDS = [
  "id",
  "title",
  "subtitle",
  "handle",
  "thumbnail",
  "status",
  "categories.id",
  "categories.name",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.barcode",
  "variants.manage_inventory",
  "variants.allow_backorder",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { sales_channel_id } = req.params
  const q = (req.query.q as string | undefined)?.trim()
  const categoryId = req.query.category_id as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

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

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id },
    pagination: { skip: 0, take: 10_000 },
  })
  const productIds = links.map((l: any) => l.product_id)

  if (!productIds.length) {
    return res.json({ products: [], count: 0, limit, offset })
  }

  const filters: Record<string, any> = {
    status: "published",
    id: productIds,
  }

  if (categoryId) {
    filters.categories = { id: categoryId }
  }

  if (q) {
    filters.$or = [
      { title: { $ilike: `%${q}%` } },
      { description: { $ilike: `%${q}%` } },
      { variants: { sku: { $ilike: `%${q}%` } } },
      { variants: { barcode: { $ilike: `%${q}%` } } },
    ]
  }

  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: POS_PRODUCT_FIELDS,
    filters,
    pagination: { take: limit, skip: offset },
  })

  const variantsForPricing = products.flatMap((p: any) => p.variants ?? [])
  if (variantsForPricing.length) {
    const { data: priced } = await query.graph({
      entity: "variant",
      fields: ["id", "calculated_price.*"],
      filters: { id: variantsForPricing.map((v: any) => v.id) },
      context: priceContext,
    })
    const priceById = new Map(priced.map((v: any) => [v.id, v.calculated_price]))
    for (const v of variantsForPricing) {
      v.calculated_price = priceById.get(v.id) ?? null
    }
  }

  const variantIds = variantsForPricing
    .filter((v: any) => v.manage_inventory)
    .map((v: any) => v.id)

  if (variantIds.length) {
    const availability = await getVariantAvailability(query, {
      variant_ids: variantIds,
      sales_channel_id,
    })
    for (const v of variantsForPricing) {
      if (v.manage_inventory) {
        v.inventory_quantity = availability[v.id]?.availability ?? 0
      }
    }
  }

  res.json({
    products,
    count: metadata?.count ?? 0,
    limit,
    offset,
  })
}
