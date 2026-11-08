import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { LOCATION_CATALOG_MODULE } from "../../modules/location-catalog"
import { provinceName } from "../locations"
import { CatalogTarget, resolveAvailability, unavailableReason } from "./index"

// Container-facing side of lib/location-catalog: fetch the rows, then let
// the pure rules decide.

/** Variant id → available in `province`, for variants whose product is known. */
export const loadAvailability = async (
  container: MedusaContainer,
  targets: CatalogTarget[],
  province: string
): Promise<Map<string, boolean>> => {
  if (!targets.length) return new Map()
  const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)
  const variantIds = [...new Set(targets.map((t) => t.variantId))]
  const productIds = [...new Set(targets.map((t) => t.productId))]
  const [variantRows, productRows] = await Promise.all([
    catalog.listLocationAvailabilities({ variant_id: variantIds, province }),
    catalog.listLocationAvailabilities({ product_id: productIds, province }),
  ])
  return resolveAvailability(targets, [...variantRows, ...productRows], province)
}

/**
 * Throw NOT_ALLOWED when any of these variants may not be bought in
 * `province`. A null province (default channel, nothing chosen) allows all.
 */
export const assertVariantsAvailable = async (
  container: MedusaContainer,
  variantIds: string[],
  province: string | null
): Promise<void> => {
  const ids = [...new Set(variantIds.filter(Boolean))]
  if (!province || !ids.length) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id", "title", "product.title"],
    filters: { id: ids },
  })
  const variants = data as any[]
  const availability = await loadAvailability(
    container,
    variants.map((v) => ({ variantId: v.id, productId: v.product_id })),
    province
  )
  const blocked = variants.find((v) => availability.get(v.id) === false)
  if (!blocked) return

  const label = [blocked.product?.title, blocked.title]
    .filter((s) => s && s !== "Default variant")
    .join(" — ")
  const reason = unavailableReason(provinceName(province))
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    label ? `${label}: ${reason}` : reason
  )
}
