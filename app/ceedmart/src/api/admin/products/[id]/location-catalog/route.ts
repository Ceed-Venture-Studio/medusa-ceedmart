import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { LOCATION_CATALOG_MODULE } from "../../../../../modules/location-catalog"
import { setProductLocationCatalogWorkflow } from "../../../../../workflows/location-catalog/set-product-location-catalog"
import type { AdminSetLocationCatalogType } from "./validators"

// GET  /admin/products/:id/location-catalog
// POST /admin/products/:id/location-catalog
//
// One product's location prices and availability, as the authoring rows
// (variant_id null = the product-level row every variant inherits). POST
// replaces the whole set and re-syncs the variants' Medusa prices.
// The states to offer come from GET /admin/location-catalog/locations.

const load = async (req: AuthenticatedMedusaRequest, productId: string) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = req.scope.resolve(LOCATION_CATALOG_MODULE)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "variants.id", "variants.title", "variants.sku"],
    filters: { id: productId },
  })
  const product = (products as any[])[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }
  const variantIds = (product.variants ?? []).map((v: any) => v.id)

  const fields = ["id", "product_id", "variant_id", "province"]
  const [pp, vp, pa, va] = await Promise.all([
    catalog.listLocationPrices(
      { product_id: productId },
      { select: [...fields, "currency_code", "amount"] }
    ),
    variantIds.length
      ? catalog.listLocationPrices(
          { variant_id: variantIds },
          { select: [...fields, "currency_code", "amount"] }
        )
      : [],
    catalog.listLocationAvailabilities(
      { product_id: productId },
      { select: [...fields, "is_available"] }
    ),
    variantIds.length
      ? catalog.listLocationAvailabilities(
          { variant_id: variantIds },
          { select: [...fields, "is_available"] }
        )
      : [],
  ])

  return {
    product: { id: product.id, title: product.title, variants: product.variants ?? [] },
    prices: [...pp, ...vp].map((r: any) => ({
      variant_id: r.variant_id ?? null,
      province: r.province,
      currency_code: r.currency_code,
      amount: Number(r.amount),
    })),
    availability: [...pa, ...va].map((r: any) => ({
      variant_id: r.variant_id ?? null,
      province: r.province,
      is_available: r.is_available,
    })),
  }
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.json({ location_catalog: await load(req, req.params.id) })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminSetLocationCatalogType>,
  res: MedusaResponse
) => {
  const body = req.validatedBody
  await setProductLocationCatalogWorkflow(req.scope).run({
    input: {
      product_id: req.params.id,
      prices: body.prices,
      availability: body.availability,
    },
  })
  res.json({ location_catalog: await load(req, req.params.id) })
}
