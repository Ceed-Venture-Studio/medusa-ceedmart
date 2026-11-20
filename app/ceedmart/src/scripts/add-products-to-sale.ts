import { batchPriceListPricesWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

// Put named products on an existing Sale price list at a fixed % off, and
// optionally correct entries already on the list that are not that % off.
//
// For every variant of every product in `products=`: its current national
// NGN price less `percent`, rounded to the nearest naira (round=naira) or
// down to the nearest ₦10 (round=ten). A variant already on the list keeps
// its price, unless `fix` is passed and that price is more than ₦1 away
// from the rule — then it is reset. `fix` applies to every entry on the list,
// not only the named products (a typo is a typo wherever it is).
//
// Dry run unless `apply` is passed:
//
//   npx medusa exec ./src/scripts/add-products-to-sale.ts \
//     list=plist_01… percent=5 round=naira fix products=prod_1,prod_2
//   … apply
//
// Idempotent: a second run finds nothing to add or fix.

const TOLERANCE = 1 // naira

export default async function addProductsToSale({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const log = (m: string) => logger.info(`[sale] ${m}`)

  const argv: string[] = (args ?? []).map((a: string) => a.replace(/^--/, ""))
  const arg = (n: string) => argv.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1)
  const apply = argv.includes("apply")
  const fix = argv.includes("fix")
  const listId = arg("list")
  const percent = Number(arg("percent"))
  const round = arg("round") ?? "naira"
  const productIds = (arg("products") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (!listId || !(percent > 0 && percent < 100) || !["naira", "ten"].includes(round)) {
    throw new Error("Usage: list=<id> percent=<1-99> round=naira|ten [fix] products=<id,…> [apply]")
  }
  const salePrice = (base: number) => {
    const raw = (base * (100 - percent)) / 100
    return round === "ten" ? Math.floor(raw / 10) * 10 : Math.round(raw)
  }

  const { data: lists } = await query.graph({
    entity: "price_list",
    fields: ["id", "title", "type", "status", "starts_at", "ends_at"],
    filters: { id: listId },
  })
  const list = (lists as any[])[0]
  if (!list) throw new Error(`Price list ${listId} not found`)
  if (list.type !== "sale") throw new Error(`${list.title} is not a Sale list`)
  log(`list: ${list.title} (${list.status}, ${list.starts_at} → ${list.ends_at}); ${percent}% off, round=${round}${fix ? ", fixing off entries" : ""}`)

  const { data: regions } = await query.graph({ entity: "region", fields: ["id"], filters: { currency_code: "ngn" } })
  const regionId = (regions as any[])[0]?.id
  if (!regionId) throw new Error("No NGN region")

  // What is on the list now: variant → its list price.
  const { data: listPrices } = await query.graph({
    entity: "price",
    fields: ["id", "amount", "currency_code", "price_set_id"],
    filters: { price_list_id: listId },
    pagination: { skip: 0, take: 10_000 },
  })
  const setIds = [...new Set((listPrices as any[]).map((p) => p.price_set_id))]
  const { data: setLinks } = setIds.length
    ? await query.graph({
        entity: "product_variant_price_set",
        fields: ["variant_id", "price_set_id"],
        filters: { price_set_id: setIds },
        pagination: { skip: 0, take: 10_000 },
      })
    : { data: [] as any[] }
  const variantOfSet = new Map((setLinks as any[]).map((l) => [l.price_set_id, l.variant_id]))
  const onList = new Map<string, any>()
  for (const p of listPrices as any[]) {
    const v = variantOfSet.get(p.price_set_id)
    if (v && p.currency_code === "ngn") onList.set(v, p)
  }

  // Variants to consider: the named products' plus everything on the list.
  const { data: named } = productIds.length
    ? await query.graph({ entity: "variant", fields: ["id"], filters: { product_id: productIds }, pagination: { skip: 0, take: 10_000 } })
    : { data: [] as any[] }
  const missingProducts = productIds.filter(Boolean)
  const variantIds = [...new Set([...(named as any[]).map((v) => v.id), ...onList.keys()])]
  if (!variantIds.length) {
    log("nothing to do")
    return
  }
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "title", "product_id", "product.title", "product.status", "calculated_price.*"],
    filters: { id: variantIds },
    context: { calculated_price: QueryContext({ region_id: regionId, currency_code: "ngn" }) },
    pagination: { skip: 0, take: 10_000 },
  })
  const seenProducts = new Set((variants as any[]).map((v) => v.product_id))
  for (const id of missingProducts) if (!seenProducts.has(id)) log(`WARNING: product ${id} not found`)

  const namedSet = new Set((named as any[]).map((v) => v.id))
  const create: any[] = []
  const update: any[] = []
  let kept = 0
  let unpriced = 0
  for (const v of variants as any[]) {
    // original_amount is the national price before any sale list.
    const base = Number(v.calculated_price?.original_amount)
    const label = `${(v.product?.title ?? "").trim()} — ${(v.title ?? "").trim()}`
    const draft = v.product?.status !== "published" ? " [draft product]" : ""
    if (!base) {
      if (namedSet.has(v.id)) {
        unpriced++
        log(`   skip (no price): ${label}${draft}`)
      }
      continue
    }
    const want = salePrice(base)
    const existing = onList.get(v.id)
    if (!existing) {
      if (!namedSet.has(v.id)) continue
      create.push({ variant_id: v.id, currency_code: "ngn", amount: want })
      log(`   add   ${label}${draft}: ₦${base} → ₦${want}`)
    } else if (fix && Math.abs(Number(existing.amount) - want) > TOLERANCE) {
      update.push({ id: existing.id, variant_id: v.id, currency_code: "ngn", amount: want })
      log(`   fix   ${label}: list ₦${Number(existing.amount)} → ₦${want} (price ₦${base})`)
    } else {
      kept++
    }
  }
  log(`${create.length} to add, ${update.length} to fix, ${kept} already right, ${unpriced} without a price`)

  if (!apply) {
    log("DRY RUN — nothing changed. Re-run with apply.")
    return
  }
  if (!create.length && !update.length) return
  await batchPriceListPricesWorkflow(container).run({
    input: { data: { id: list.id, create, update, delete: [] } },
  })
  log(`done: added ${create.length}, fixed ${update.length}`)
}
