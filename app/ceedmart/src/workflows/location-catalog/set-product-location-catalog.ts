import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { isProvinceCode } from "../../lib/locations"
import { LOCATION_CATALOG_MODULE } from "../../modules/location-catalog"
import { syncLocationPricesStep } from "./sync-location-prices"

// Replace one product's location prices and availability, then re-sync its
// variants' Medusa prices.
//
// The admin screen edits a product and its variants as one table, so the
// input is that whole table: rows not sent are removed. `variant_id: null`
// is the product-level row every variant inherits unless it has its own.

export type SetProductLocationCatalogInput = {
  product_id: string
  prices: {
    variant_id?: string | null
    province: string
    currency_code: string
    amount: number
  }[]
  availability: {
    variant_id?: string | null
    province: string
    is_available: boolean
  }[]
}

type Previous = { priceIds: string[]; availabilityIds: string[] }
type Replaced = { previous: Previous; created: Previous }

const replaceLocationCatalogStep = createStep(
  "replace-product-location-catalog",
  async (input: SetProductLocationCatalogInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id"],
      filters: { product_id: input.product_id },
    })
    const variantIds = new Set((variants as any[]).map((v) => v.id))

    const invalid = (msg: string) =>
      new MedusaError(MedusaError.Types.INVALID_DATA, msg)

    const seen = new Set<string>()
    for (const p of input.prices) {
      if (!isProvinceCode(p.province)) throw invalid(`Unknown state code "${p.province}"`)
      if (p.variant_id && !variantIds.has(p.variant_id))
        throw invalid(`Variant ${p.variant_id} is not part of this product`)
      if (!(Number.isFinite(p.amount) && p.amount >= 0))
        throw invalid("Location prices must be zero or more")
      const key = `${p.variant_id ?? ""}|${p.province}|${p.currency_code.toLowerCase()}`
      if (seen.has(key)) throw invalid("A price is listed twice for the same state")
      seen.add(key)
    }
    seen.clear()
    for (const a of input.availability) {
      if (!isProvinceCode(a.province)) throw invalid(`Unknown state code "${a.province}"`)
      if (a.variant_id && !variantIds.has(a.variant_id))
        throw invalid(`Variant ${a.variant_id} is not part of this product`)
      const key = `${a.variant_id ?? ""}|${a.province}`
      if (seen.has(key)) throw invalid("Availability is listed twice for the same state")
      seen.add(key)
    }

    const ids = [...variantIds]
    const [oldProductPrices, oldVariantPrices, oldProductAvail, oldVariantAvail] =
      await Promise.all([
        catalog.listLocationPrices({ product_id: input.product_id }, { select: ["id"] }),
        ids.length
          ? catalog.listLocationPrices({ variant_id: ids }, { select: ["id"] })
          : [],
        catalog.listLocationAvailabilities(
          { product_id: input.product_id },
          { select: ["id"] }
        ),
        ids.length
          ? catalog.listLocationAvailabilities({ variant_id: ids }, { select: ["id"] })
          : [],
      ])
    const previous: Previous = {
      priceIds: [...oldProductPrices, ...oldVariantPrices].map((r: any) => r.id),
      availabilityIds: [...oldProductAvail, ...oldVariantAvail].map((r: any) => r.id),
    }

    if (previous.priceIds.length) await catalog.softDeleteLocationPrices(previous.priceIds)
    if (previous.availabilityIds.length)
      await catalog.softDeleteLocationAvailabilities(previous.availabilityIds)

    const target = (variantId?: string | null) =>
      variantId
        ? { variant_id: variantId, product_id: null }
        : { product_id: input.product_id, variant_id: null }

    const createdPrices = input.prices.length
      ? await catalog.createLocationPrices(
          input.prices.map((p) => ({
            ...target(p.variant_id),
            province: p.province,
            currency_code: p.currency_code.toLowerCase(),
            amount: p.amount,
          }))
        )
      : []
    // "Available" is the default, so only exclusions are stored — except a
    // variant row re-enabling what its product row excludes.
    const productExcluded = new Set(
      input.availability
        .filter((a) => !a.variant_id && !a.is_available)
        .map((a) => a.province)
    )
    const toStore = input.availability.filter((a) =>
      a.variant_id
        ? a.is_available !== !productExcluded.has(a.province)
        : !a.is_available
    )
    const createdAvail = toStore.length
      ? await catalog.createLocationAvailabilities(
          toStore.map((a) => ({
            ...target(a.variant_id),
            province: a.province,
            is_available: a.is_available,
          }))
        )
      : []

    const replaced: Replaced = {
      previous,
      created: {
        priceIds: createdPrices.map((r: any) => r.id),
        availabilityIds: createdAvail.map((r: any) => r.id),
      },
    }
    return new StepResponse(replaced, replaced)
  },
  async (replaced, { container }) => {
    if (!replaced) return
    const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)
    const { previous, created } = replaced
    if (created.priceIds.length) await catalog.deleteLocationPrices(created.priceIds)
    if (created.availabilityIds.length)
      await catalog.deleteLocationAvailabilities(created.availabilityIds)
    if (previous.priceIds.length) await catalog.restoreLocationPrices(previous.priceIds)
    if (previous.availabilityIds.length)
      await catalog.restoreLocationAvailabilities(previous.availabilityIds)
  }
)

export const setProductLocationCatalogWorkflow = createWorkflow(
  "set-product-location-catalog",
  (input: WorkflowData<SetProductLocationCatalogInput>) => {
    replaceLocationCatalogStep(input)
    const syncInput = transform({ input }, ({ input }) => ({
      product_ids: [input.product_id],
    }))
    syncLocationPricesStep(syncInput)
    return new WorkflowResponse({ product_id: input.product_id })
  }
)
