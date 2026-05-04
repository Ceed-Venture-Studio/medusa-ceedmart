// Catalog-driven recommendation engine.
//
// === Catalog convention ===
// Products participate in solar recommendations by setting these fields under
// their `metadata` (admin → Products → Metadata):
//
//   metadata.solar_role    "inverter" | "battery" | "panel"
//   metadata.capacity_kw   number  (inverter only — kVA/kW rating)
//   metadata.capacity_kwh  number  (battery only — usable energy)
//   metadata.panel_watts   number  (panel only — per-panel wattage)
//
// The engine only looks at products with `solar_role` set, so untagged
// products are invisible to it. If the catalog has nothing tagged yet,
// /store/solar/recommend still returns the load math, but `bundles` is empty
// and `catalog_ready: false` — the storefront should show a "we'll prepare a
// custom quote" message in that case.

import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { LoadProfile } from "./calculate"
import { describeCapacity, type CanPowerEntry } from "./appliances"

const SUN_HOURS_PER_DAY = 4 // Lagos average; conservative

export type SolarComponent = {
  product_id: string
  variant_id: string | null
  title: string
  thumbnail: string | null
  capacity_kw?: number
  capacity_kwh?: number
  panel_watts?: number
  qty: number
  unit_price: number | null
  currency_code: string | null
}

export type SolarBundle = {
  tier: "budget" | "recommended" | "premium"
  margin_pct: number
  inverter: SolarComponent | null
  battery: SolarComponent | null
  panels: SolarComponent | null
  total_price: number | null
  currency_code: string | null
  why: string[]
  can_power: CanPowerEntry[]
  cannot_power: string[]
}

export type RecommendResult = {
  catalog_ready: boolean
  bundles: SolarBundle[]
  notes: string[]
}

type CatalogItem = {
  id: string
  title: string
  thumbnail: string | null
  metadata: Record<string, any>
  variants: Array<{
    id: string
    calculated_price: { calculated_amount?: number | null; currency_code?: string | null } | null
  }>
}

const TIER_MARGINS: Array<{ tier: SolarBundle["tier"]; multiplier: number }> = [
  { tier: "budget", multiplier: 1.0 },
  { tier: "recommended", multiplier: 1.25 },
  { tier: "premium", multiplier: 1.5 },
]

export async function recommend(
  container: MedusaContainer,
  load: LoadProfile,
  ctx?: { sales_channel_id?: string }
): Promise<RecommendResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Pull NGN region for pricing context — same convention as POS routes.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
    filters: { currency_code: "ngn" },
  })
  const ngnRegion = regions[0]
  const priceContext = ngnRegion
    ? {
        calculated_price: QueryContext({
          region_id: ngnRegion.id,
          currency_code: "ngn",
        }),
      }
    : undefined

  // Limit by sales channel if provided, otherwise scan everything published.
  let productIdFilter: string[] | undefined
  if (ctx?.sales_channel_id) {
    const { data: links } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: { sales_channel_id: ctx.sales_channel_id },
      pagination: { skip: 0, take: 10_000 },
    })
    productIdFilter = links.map((l: any) => l.product_id)
    if (!productIdFilter.length) {
      return { catalog_ready: false, bundles: [], notes: ["No products in sales channel"] }
    }
  }

  const filters: Record<string, any> = { status: "published" }
  if (productIdFilter) filters.id = productIdFilter

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "metadata", "variants.id"],
    filters,
    pagination: { skip: 0, take: 1000 },
  })

  // Fetch variant prices in a separate scoped query — the calculated_price
  // pricing context doesn't propagate through nested product.variants graph
  // fields (Medusa pricing module wants currency_code at variant scope).
  const variantIds = (products as CatalogItem[])
    .flatMap((p) => p.variants ?? [])
    .map((v: any) => v.id)
  const priceById = new Map<string, any>()
  if (variantIds.length && priceContext) {
    const { data: priced } = await query.graph({
      entity: "variant",
      fields: ["id", "calculated_price.*"],
      filters: { id: variantIds },
      context: priceContext,
    })
    for (const v of priced as any[]) {
      priceById.set(v.id, v.calculated_price)
    }
  }
  for (const p of products as CatalogItem[]) {
    for (const v of p.variants ?? []) {
      ;(v as any).calculated_price = priceById.get(v.id) ?? null
    }
  }

  // Bucket by solar_role.
  const inverters: CatalogItem[] = []
  const batteries: CatalogItem[] = []
  const panels: CatalogItem[] = []

  for (const p of products as CatalogItem[]) {
    const role = String(p.metadata?.solar_role || "").toLowerCase()
    if (role === "inverter" && Number(p.metadata?.capacity_kw) > 0) inverters.push(p)
    else if (role === "battery" && Number(p.metadata?.capacity_kwh) > 0) batteries.push(p)
    else if (role === "panel" && Number(p.metadata?.panel_watts) > 0) panels.push(p)
  }

  // Sort once, ascending by capacity, so "smallest fit" picks are O(n).
  inverters.sort((a, b) => Number(a.metadata.capacity_kw) - Number(b.metadata.capacity_kw))
  batteries.sort((a, b) => Number(a.metadata.capacity_kwh) - Number(b.metadata.capacity_kwh))
  panels.sort((a, b) => Number(b.metadata.panel_watts) - Number(a.metadata.panel_watts)) // largest panel first → fewer units

  const notes: string[] = []
  if (!inverters.length) notes.push("No inverters tagged in catalog (set metadata.solar_role=inverter, metadata.capacity_kw)")
  if (!batteries.length) notes.push("No batteries tagged in catalog (set metadata.solar_role=battery, metadata.capacity_kwh)")
  if (!panels.length) notes.push("No solar panels tagged in catalog (set metadata.solar_role=panel, metadata.panel_watts)")

  if (!inverters.length || !batteries.length || !panels.length) {
    return { catalog_ready: false, bundles: [], notes }
  }

  const totalLoadKw = load.total_load_w / 1000
  const peakLoadKw = load.peak_load_w / 1000

  const bundles: SolarBundle[] = TIER_MARGINS.map(({ tier, multiplier }) => {
    const effectiveMargin = load.has_heavy_motors
      ? Math.max(multiplier, 1.5)
      : multiplier

    // Inverter must cover peak load (already includes surge). For tiers above
    // budget we apply margin on top of peak too.
    const inverterMin = peakLoadKw * effectiveMargin
    const batteryMin = load.night_kwh * effectiveMargin
    const panelTotalW = (load.daily_kwh * 1000 * effectiveMargin) / SUN_HOURS_PER_DAY

    const inv = pickSmallestFit(inverters, "capacity_kw", inverterMin)
    const bat = pickSmallestFit(batteries, "capacity_kwh", batteryMin)
    const pnl = panels[0] // largest panel
    const panelQty = Math.max(1, Math.ceil(panelTotalW / Number(pnl.metadata.panel_watts)))

    const inverter = inv ? toComponent(inv, 1, { capacity_kw: Number(inv.metadata.capacity_kw) }) : null
    const battery = bat ? toComponent(bat, 1, { capacity_kwh: Number(bat.metadata.capacity_kwh) }) : null
    const panelComp = toComponent(pnl, panelQty, { panel_watts: Number(pnl.metadata.panel_watts) })

    const components = [inverter, battery, panelComp]
    const currency = components.find((c) => c?.currency_code)?.currency_code ?? null
    const total_price = components.reduce<number | null>((acc, c) => {
      if (!c?.unit_price) return acc
      return (acc ?? 0) + c.unit_price * c.qty
    }, null)

    const inverterKw = inverter?.capacity_kw ?? totalLoadKw
    const dailyBudgetKwh = inverterKw * SUN_HOURS_PER_DAY + (battery?.capacity_kwh ?? 0)
    const { canPower, cannotPower } = describeCapacity(dailyBudgetKwh, inverterKw)

    const why: string[] = [
      `Total load ${totalLoadKw.toFixed(1)} kW (peak ${peakLoadKw.toFixed(1)} kW with surge)`,
      `Daily energy need ${load.daily_kwh.toFixed(1)} kWh, night ${load.night_kwh.toFixed(1)} kWh`,
      `${tier === "budget" ? "Bare-fit" : tier === "recommended" ? "Balanced" : "Future-proof"} sizing — ${Math.round((effectiveMargin - 1) * 100)}% safety margin`,
    ]
    if (load.has_heavy_motors) {
      why.push("Heavy motor loads detected — sized with extra surge headroom")
    }

    return {
      tier,
      margin_pct: Math.round((effectiveMargin - 1) * 100),
      inverter,
      battery,
      panels: panelComp,
      total_price,
      currency_code: currency,
      why,
      can_power: canPower,
      cannot_power: cannotPower,
    }
  })

  return { catalog_ready: true, bundles, notes }
}

function pickSmallestFit(
  items: CatalogItem[],
  capacityField: "capacity_kw" | "capacity_kwh",
  minimum: number
): CatalogItem | null {
  const fit = items.find((i) => Number(i.metadata[capacityField]) >= minimum)
  // If nothing meets the minimum, return the largest available so we still
  // produce a bundle (storefront will see the shortfall in `why` later if we
  // add it). For MVP we just take the biggest.
  return fit ?? items[items.length - 1] ?? null
}

function toComponent(
  item: CatalogItem,
  qty: number,
  caps: Partial<Pick<SolarComponent, "capacity_kw" | "capacity_kwh" | "panel_watts">>
): SolarComponent {
  const variant = item.variants?.[0]
  const price = variant?.calculated_price ?? null
  return {
    product_id: item.id,
    variant_id: variant?.id ?? null,
    title: item.title,
    thumbnail: item.thumbnail ?? null,
    qty,
    unit_price: price?.calculated_amount ?? null,
    currency_code: price?.currency_code ?? null,
    ...caps,
  }
}
