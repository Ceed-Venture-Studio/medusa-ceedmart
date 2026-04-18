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
  const { sales_channel_id, barcode } = req.params

  if (!barcode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Barcode is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { currency_code: "ngn" },
  })
  const ngnRegion = regions[0]
  if (!ngnRegion) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Nigeria region (NGN) is not configured"
    )
  }

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id },
    pagination: { skip: 0, take: 10_000 },
  })
  const productIds = links.map((l: any) => l.product_id)

  if (!productIds.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No products in sales channel ${sales_channel_id}`
    )
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: POS_PRODUCT_FIELDS,
    filters: {
      status: "published",
      id: productIds,
      variants: { barcode },
    },
  })

  const product = products[0]
  const variant = product?.variants?.find((v: any) => v.barcode === barcode)

  if (!product || !variant) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No variant found for barcode "${barcode}" in sales channel ${sales_channel_id}`
    )
  }

  const { data: priced } = await query.graph({
    entity: "variant",
    fields: ["id", "calculated_price.*"],
    filters: { id: variant.id },
    context: {
      calculated_price: QueryContext({
        region_id: ngnRegion.id,
        currency_code: "ngn",
      }),
    },
  })
  ;(variant as any).calculated_price = priced[0]?.calculated_price ?? null

  if (variant.manage_inventory) {
    const availability = await getVariantAvailability(query, {
      variant_ids: [variant.id],
      sales_channel_id,
    })
    ;(variant as any).inventory_quantity =
      availability[variant.id]?.availability ?? 0
  }

  res.json({ product, variant })
}
