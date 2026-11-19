import { batchPriceListPricesWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import { salePrice } from "./black-friday-2026"

// Add whole categories to an existing Sale price list.
//
// Every published product in the given categories (and their
// sub-categories) gets a sale price on each variant: its current national
// NGN price less `percent`, rounded down to the nearest ₦10 — the same rule
// as scripts/black-friday-2026.ts. Variants already on ANY price list are
// left alone, so nothing ends up with two sale prices.
//
// Dry run unless `apply` is passed:
//
//   npx medusa exec ./src/scripts/add-categories-to-sale.ts \
//     list=plist_01… percent=5 categories=soups-spices,cans-paste,oils-condiments
//   … apply
//
// Idempotent: a second run finds the variants already listed and adds none.

export default async function addCategoriesToSale({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const log = (m: string) => logger.info(`[add-to-sale] ${m}`)

  const argv: string[] = (args ?? []).map((a: string) => a.replace(/^--/, ""))
  const arg = (name: string) => argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
  const apply = argv.includes("apply")
  const listId = arg("list")
  const percent = Number(arg("percent"))
  const handles = (arg("categories") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (!listId || !(percent > 0 && percent < 100) || !handles.length) {
    throw new Error("Usage: list=<price_list_id> percent=<1-99> categories=<handle,…> [apply]")
  }

  const { data: lists } = await query.graph({
    entity: "price_list",
    fields: ["id", "title", "type", "status", "starts_at", "ends_at"],
    filters: { id: listId },
  })
  const list = (lists as any[])[0]
  if (!list) throw new Error(`Price list ${listId} not found`)
  if (list.type !== "sale") throw new Error(`${list.title} is not a Sale list`)
  log(`list: ${list.title} (${list.status}, ${list.starts_at} → ${list.ends_at}), ${percent}% off`)

  // Categories by handle, plus every descendant.
  const { data: allCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "name", "mpath"],
  })
  const roots = (allCategories as any[]).filter((c) => handles.includes(c.handle))
  const missing = handles.filter((h) => !roots.some((c) => c.handle === h))
  if (missing.length) throw new Error(`Unknown category handle(s): ${missing.join(", ")}`)
  const categoryIds = (allCategories as any[])
    .filter((c) =>
      roots.some((r) => c.id === r.id || (c.mpath ?? "").includes(`${r.id}.`) && c.id !== r.id)
    )
    .map((c) => c.id)
  log(`categories: ${roots.map((c) => c.name).join(", ")} (${categoryIds.length} incl. sub-categories)`)

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "products.id", "products.status"],
    filters: { id: categoryIds },
  })
  const productIds = [
    ...new Set(
      (categories as any[]).flatMap((c) =>
        (c.products ?? []).filter((p: any) => p.status === "published").map((p: any) => p.id)
      )
    ),
  ]

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { currency_code: "ngn" },
  })
  const regionId = (regions as any[])[0]?.id
  if (!regionId) throw new Error("No NGN region")

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "title", "product.title", "price_set.id", "calculated_price.*"],
    filters: { product_id: productIds },
    context: {
      calculated_price: QueryContext({ region_id: regionId, currency_code: "ngn" }),
    },
  })

  // Variants already carrying any price-list price.
  const priceSetIds = (variants as any[]).map((v) => v.price_set?.id).filter(Boolean)
  const { data: listed } = priceSetIds.length
    ? await query.graph({
        entity: "price",
        fields: ["price_set_id", "price_list_id"],
        filters: { price_set_id: priceSetIds, price_list_id: { $ne: null } },
        pagination: { take: 100_000, skip: 0 },
      })
    : { data: [] as any[] }
  const alreadyListed = new Set((listed as any[]).map((p) => p.price_set_id))

  const create: any[] = []
  let skippedListed = 0
  let skippedUnpriced = 0
  for (const v of variants as any[]) {
    if (alreadyListed.has(v.price_set?.id)) {
      skippedListed++
      continue
    }
    const current = Number(v.calculated_price?.original_amount)
    if (!current) {
      skippedUnpriced++
      continue
    }
    const amount = salePrice(current, percent)
    create.push({ variant_id: v.id, currency_code: "ngn", amount })
    log(`   ${v.product?.title} — ${v.title}: ₦${current} → ₦${amount}`)
  }
  log(
    `${productIds.length} products: ${create.length} variants to add, ` +
      `${skippedListed} already on a price list, ${skippedUnpriced} without a price`
  )

  if (!apply || !create.length) {
    if (!apply) log("DRY RUN — nothing changed. Re-run with apply.")
    return
  }
  await batchPriceListPricesWorkflow(container).run({
    input: { data: { id: list.id, create, update: [], delete: [] } },
  })
  log(`added ${create.length} prices to ${list.title}`)
}
