import {
  createPriceListsWorkflow,
  updatePromotionsStatusWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import { LOCATION_CATALOG_MODULE } from "../modules/location-catalog"
import { setProductLocationCatalogWorkflow } from "../workflows/location-catalog/set-product-location-catalog"

// Black Friday 2026: move the sale from automatic promotions to Sale price
// lists, so the discount shows on product pages and at the till.
//
// Medusa promotions only ever apply inside a cart; product pages and the
// POS price from the pricing module, which a Sale price list feeds. So for
// each promotion below this:
//   1. builds a Sale price list for the products its target rules select
//      (categories, AND product types where the promotion has them), priced
//      at the current national NGN price less the percentage, rounded DOWN to
//      the nearest ₦10, running exactly as long as the promotion's campaign;
//   2. sets the promotion inactive, so carts do not discount twice.
//
// It also removes location prices under ₦10 on those products — on
// 2026-11-19 that was Peak 123 (360g) at ₦1 in Rivers. It goes through the
// same workflow as the admin "Location prices" editor, so the next price
// sync does not put it back.
//
// Dry run unless `apply` is passed. Refuses to create a list whose title
// already exists, so a second apply does nothing.
//
//   npx medusa exec ./src/scripts/black-friday-2026.ts
//   npx medusa exec ./src/scripts/black-friday-2026.ts apply

const SALES = [
  { code: "BLKFRIDAY10", percent: 10, title: "Black Friday 2026 — Technology 10%" },
  { code: "BLKFRIDAY5", percent: 5, title: "Black Friday 2026 — Wholefoods 5%" },
]
const ROUND_TO = 10
const SUSPECT_LOCATION_PRICE_BELOW = 10

export const salePrice = (current: number, percent: number) =>
  Math.floor((current * (100 - percent)) / 100 / ROUND_TO) * ROUND_TO

export default async function blackFriday2026({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(LOCATION_CATALOG_MODULE)
  const apply = (args ?? []).map((a: string) => a.replace(/^--/, "")).includes("apply")
  const log = (m: string) => logger.info(`[black-friday] ${m}`)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { currency_code: "ngn" },
  })
  const regionId = (regions as any[])[0]?.id
  if (!regionId) throw new Error("No NGN region")

  const { data: existingLists } = await query.graph({
    entity: "price_list",
    fields: ["id", "title"],
  })
  const existingTitles = new Set((existingLists as any[]).map((l) => l.title))

  const plans: any[] = []
  const allProductIds = new Set<string>()

  for (const sale of SALES) {
    const { data: promos } = await query.graph({
      entity: "promotion",
      fields: [
        "id",
        "code",
        "status",
        "campaign.starts_at",
        "campaign.ends_at",
        "application_method.target_rules.attribute",
        "application_method.target_rules.values.value",
      ],
      filters: { code: sale.code },
    })
    const promo = (promos as any[])[0]
    if (!promo) throw new Error(`Promotion ${sale.code} not found`)

    const ruleValues = (attribute: string) =>
      (promo.application_method?.target_rules ?? [])
        .filter((r: any) => r.attribute === attribute)
        .flatMap((r: any) => (r.values ?? []).map((v: any) => v.value))
    const categoryIds: string[] = ruleValues("items.product.categories.id")
    const typeIds: string[] = ruleValues("items.product.type_id")
    const unsupported = (promo.application_method?.target_rules ?? []).filter(
      (r: any) =>
        !["items.product.categories.id", "items.product.type_id"].includes(r.attribute)
    )
    if (unsupported.length) {
      throw new Error(
        `${sale.code} has target rules this script does not translate: ${unsupported
          .map((r: any) => r.attribute)
          .join(", ")}`
      )
    }

    const { data: categories } = await query.graph({
      entity: "product_category",
      fields: ["id", "products.id", "products.status", "products.type_id"],
      filters: { id: categoryIds },
    })
    const productIds = new Set<string>()
    for (const c of categories as any[]) {
      for (const p of c.products ?? []) {
        if (p.status !== "published") continue
        if (typeIds.length && !typeIds.includes(p.type_id)) continue
        productIds.add(p.id)
      }
    }
    productIds.forEach((id) => allProductIds.add(id))

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "title", "product.title", "calculated_price.*"],
      filters: { product_id: [...productIds] },
      context: {
        calculated_price: QueryContext({ region_id: regionId, currency_code: "ngn" }),
      },
    })

    const prices: any[] = []
    let unpriced = 0
    for (const v of variants as any[]) {
      const current = Number(v.calculated_price?.original_amount)
      if (!current) {
        unpriced++
        continue
      }
      prices.push({
        variant_id: v.id,
        currency_code: "ngn",
        amount: salePrice(current, sale.percent),
        _label: `${v.product?.title} — ${v.title}`,
        _current: current,
      })
    }

    plans.push({ sale, promo, prices, unpriced, products: productIds.size })
    log(
      `${sale.title}: ${productIds.size} products, ${prices.length} variants priced, ` +
        `${unpriced} without a price skipped; ` +
        `${promo.campaign?.starts_at?.toISOString?.() ?? promo.campaign?.starts_at} → ` +
        `${promo.campaign?.ends_at?.toISOString?.() ?? promo.campaign?.ends_at}; ` +
        `promotion ${sale.code} is ${promo.status}` +
        (existingTitles.has(sale.title) ? " — LIST ALREADY EXISTS, will skip" : "")
    )
    for (const p of prices.slice(0, 5)) {
      log(`   ${p._label}: ₦${p._current} → ₦${p.amount}`)
    }
  }

  // ── Location prices that cannot be right ─────────────────────────────
  const [productRows, variantRows] = await Promise.all([
    catalog.listLocationPrices({ product_id: [...allProductIds] }),
    (async () => {
      const { data } = await query.graph({
        entity: "variant",
        fields: ["id", "product_id"],
        filters: { product_id: [...allProductIds] },
      })
      const ids = (data as any[]).map((v) => v.id)
      return ids.length ? catalog.listLocationPrices({ variant_id: ids }) : []
    })(),
  ])
  const { data: variantOwners } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id", "title", "product.title"],
    filters: { product_id: [...allProductIds] },
  })
  const ownerOf = new Map((variantOwners as any[]).map((v) => [v.id, v]))
  const suspect = [...productRows, ...variantRows].filter(
    (r: any) => Number(r.amount) < SUSPECT_LOCATION_PRICE_BELOW
  )
  const suspectProducts = new Set<string>(
    suspect.map((r: any) => r.product_id ?? ownerOf.get(r.variant_id)?.product_id)
  )
  for (const r of suspect) {
    const v = r.variant_id ? ownerOf.get(r.variant_id) : null
    log(
      `location price to remove: ${v ? `${v.product?.title} — ${v.title}` : r.product_id} ` +
        `${r.province} ₦${Number(r.amount)}`
    )
  }

  if (!apply) {
    log("DRY RUN — nothing changed. Re-run with apply.")
    return
  }

  // 1. Remove the impossible location prices (keeps every other row).
  for (const productId of suspectProducts) {
    const { data } = await query.graph({
      entity: "variant",
      fields: ["id"],
      filters: { product_id: productId },
    })
    const ids = (data as any[]).map((v) => v.id)
    const [pp, vp, pa, va] = await Promise.all([
      catalog.listLocationPrices({ product_id: productId }),
      ids.length ? catalog.listLocationPrices({ variant_id: ids }) : [],
      catalog.listLocationAvailabilities({ product_id: productId }),
      ids.length ? catalog.listLocationAvailabilities({ variant_id: ids }) : [],
    ])
    await setProductLocationCatalogWorkflow(container).run({
      input: {
        product_id: productId,
        prices: [...pp, ...vp]
          .filter((r: any) => Number(r.amount) >= SUSPECT_LOCATION_PRICE_BELOW)
          .map((r: any) => ({
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
      },
    })
    log(`removed impossible location price(s) on ${productId}`)
  }

  // 2. Price lists, then 3. retire the promotions they replace.
  for (const plan of plans) {
    if (existingTitles.has(plan.sale.title)) {
      log(`${plan.sale.title} already exists — skipped`)
    } else {
      const { result } = await createPriceListsWorkflow(container).run({
        input: {
          price_lists_data: [
            {
              title: plan.sale.title,
              description:
                `${plan.sale.percent}% off, replacing automatic promotion ` +
                `${plan.sale.code} so the sale price shows on product pages and at the till.`,
              type: "sale",
              status: "active",
              starts_at: plan.promo.campaign?.starts_at ?? undefined,
              ends_at: plan.promo.campaign?.ends_at ?? undefined,
              prices: plan.prices.map(({ variant_id, currency_code, amount }: any) => ({
                variant_id,
                currency_code,
                amount,
              })),
            } as any,
          ],
        },
      })
      log(`created ${plan.sale.title} (${(result as any[])[0]?.id}) with ${plan.prices.length} prices`)
    }

    if (plan.promo.status !== "inactive") {
      await updatePromotionsStatusWorkflow(container).run({
        input: { promotionsData: [{ id: plan.promo.id, status: "inactive" as any }] },
      })
      log(`promotion ${plan.sale.code} set inactive`)
    }
  }
}
