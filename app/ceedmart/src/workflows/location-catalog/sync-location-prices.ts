import type { IPricingModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ExistingPrice,
  LocationPriceRow,
  planLocationPriceSync,
  PriceToCreate,
} from "../../lib/location-catalog"
import { LOCATION_CATALOG_MODULE } from "../../modules/location-catalog"

// Bring products' variant prices in line with their location price rows.
//
// Idempotent and convergent: it computes the full desired set from the
// authoring rows every time, so it is safe to run after anything that might
// have disturbed a price set — an admin edit of location prices, a new
// variant (which is how variants inherit the product's price), or the stock
// "Edit prices" grid, which rewrites a variant's prices without ours.

type SyncInput = { product_ids: string[] }

type Applied = {
  removed: (PriceToCreate & { id: string })[]
  createdIds: string[]
}

const groupByPriceSet = (prices: PriceToCreate[]) => {
  const groups = new Map<string, PriceToCreate[]>()
  for (const p of prices) {
    const list = groups.get(p.price_set_id) ?? []
    list.push(p)
    groups.set(p.price_set_id, list)
  }
  return groups
}

const addAll = async (pricing: IPricingModuleService, prices: PriceToCreate[]) => {
  const created: string[] = []
  for (const [priceSetId, list] of groupByPriceSet(prices)) {
    const before = new Set(
      (await pricing.listPrices({ price_set_id: [priceSetId] }, { select: ["id"] })).map(
        (p) => p.id
      )
    )
    await pricing.addPrices({
      priceSetId,
      prices: list.map(({ currency_code, amount, rules }) => ({
        currency_code,
        amount,
        rules,
      })),
    })
    const after = await pricing.listPrices(
      { price_set_id: [priceSetId] },
      { select: ["id"] }
    )
    created.push(...after.map((p) => p.id).filter((id) => !before.has(id)))
  }
  return created
}

export const syncLocationPricesStep = createStep(
  "sync-location-prices",
  async (input: SyncInput, { container }) => {
    const empty: Applied = { removed: [], createdIds: [] }
    if (!input.product_ids.length) return new StepResponse(empty, empty)

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const pricing = container.resolve<IPricingModuleService>(Modules.PRICING)
    const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "product_id", "price_set.id"],
      filters: { product_id: input.product_ids },
    })
    const withSets = (variants as any[]).filter((v) => v.price_set?.id)
    if (!withSets.length) return new StepResponse(empty, empty)

    const prices = await pricing.listPrices(
      { price_set_id: withSets.map((v) => v.price_set.id) },
      { relations: ["price_rules", "price_list"] }
    )
    const pricesBySet = new Map<string, ExistingPrice[]>()
    for (const p of prices as any[]) {
      const list = pricesBySet.get(p.price_set_id) ?? []
      list.push({
        id: p.id,
        amount: p.amount,
        currency_code: p.currency_code,
        price_list_id: p.price_list_id ?? p.price_list?.id ?? null,
        price_rules: (p.price_rules ?? []).map((r: any) => ({
          attribute: r.attribute,
          value: r.value,
        })),
      })
      pricesBySet.set(p.price_set_id, list)
    }

    const [productRows, variantRows] = await Promise.all([
      catalog.listLocationPrices({ product_id: input.product_ids }),
      catalog.listLocationPrices({ variant_id: withSets.map((v) => v.id) }),
    ])

    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
    })
    const regionIdsByCurrency: Record<string, string[]> = {}
    for (const r of regions as any[]) {
      const c = r.currency_code.toLowerCase()
      ;(regionIdsByCurrency[c] ??= []).push(r.id)
    }

    const plan = planLocationPriceSync(
      withSets.map((v) => ({
        id: v.id,
        product_id: v.product_id,
        price_set_id: v.price_set.id,
        prices: pricesBySet.get(v.price_set.id) ?? [],
      })),
      [...productRows, ...variantRows] as LocationPriceRow[],
      regionIdsByCurrency
    )

    // Kept so compensation can put removed prices back as they were.
    const removed = (prices as any[])
      .filter((p) => plan.remove.includes(p.id))
      .map((p) => ({
        id: p.id,
        price_set_id: p.price_set_id,
        currency_code: p.currency_code,
        amount: Number(p.amount),
        rules: Object.fromEntries(
          (p.price_rules ?? []).map((r: any) => [r.attribute, r.value])
        ),
      }))

    if (plan.remove.length) await pricing.removePrices(plan.remove)
    const createdIds = plan.create.length ? await addAll(pricing, plan.create) : []

    const applied: Applied = { removed, createdIds }
    return new StepResponse(applied, applied)
  },
  async (applied, { container }) => {
    if (!applied) return
    const pricing = container.resolve<IPricingModuleService>(Modules.PRICING)
    if (applied.createdIds.length) await pricing.removePrices(applied.createdIds)
    if (applied.removed.length) await addAll(pricing, applied.removed)
  }
)

export const syncLocationPricesWorkflow = createWorkflow(
  "sync-location-prices",
  (input: WorkflowData<SyncInput>) => {
    const result = syncLocationPricesStep(input)
    return new WorkflowResponse(result)
  }
)
