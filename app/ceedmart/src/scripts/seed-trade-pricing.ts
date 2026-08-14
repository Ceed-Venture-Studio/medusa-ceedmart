import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

// Sets up bulk (volume-break) pricing and the flat Trade customer group.
//
// Pricing model — one public price per variant, with quantity breaks that
// EVERYONE can see. Nothing is gated behind login. Medusa resolves the right
// tier natively: packages/modules/pricing/src/repositories/pricing.ts filters
// prices by `min_quantity <= quantity <= max_quantity`, defaulting to 1 when
// no quantity is supplied. So a tier is just an extra `price` row on the same
// price_set — no price_list required.
//
// The Trade customer group is created for segmentation (who qualifies via
// order size), NOT for pricing. It carries no price list of its own.
//
// SAFETY: this writes prices. It runs in DRY-RUN mode unless APPLY=true.
//
// Usage:
//   # preview what would change
//   yarn medusa exec ./src/scripts/seed-trade-pricing.ts
//
//   # write it
//   APPLY=true yarn medusa exec ./src/scripts/seed-trade-pricing.ts
//
//   # only a given category subtree, custom tiers
//   CATEGORY_HANDLES=whole-foods,groceries TIERS=10:5,50:10,100:15 \
//     APPLY=true yarn medusa exec ./src/scripts/seed-trade-pricing.ts
//
// Env vars:
//   APPLY             "true" to persist. Anything else = dry run.
//   TIERS             Comma list of <minQty>:<percentOff>. Default 10:5,50:10,100:15
//   CATEGORY_HANDLES  Comma list of category handles to limit to. Default: all.
//                     Tiers are applied to the category AND its descendants.
//   TRADE_GROUP_NAME  Customer group name. Default "Trade".

const TRADE_GROUP_NAME = process.env.TRADE_GROUP_NAME || "Trade"
const APPLY = process.env.APPLY === "true"

type Tier = { minQuantity: number; percentOff: number }

const parseTiers = (): Tier[] => {
  const raw = process.env.TIERS || "10:5,50:10,100:15"
  const tiers = raw.split(",").map((part) => {
    const [qty, off] = part.split(":").map((n) => Number(n.trim()))
    if (!Number.isFinite(qty) || !Number.isFinite(off) || qty < 2 || off <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid tier "${part}". Expected <minQty>:<percentOff>, e.g. 10:5`
      )
    }
    return { minQuantity: qty, percentOff: off }
  })

  tiers.sort((a, b) => a.minQuantity - b.minQuantity)

  // Overlapping or non-increasing tiers would make the resolved price depend
  // on row order, which is not deterministic. Reject rather than guess.
  tiers.forEach((tier, i) => {
    if (i > 0 && tier.minQuantity === tiers[i - 1].minQuantity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Duplicate tier min quantity ${tier.minQuantity}`
      )
    }
    if (i > 0 && tier.percentOff <= tiers[i - 1].percentOff) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Tier ${tier.minQuantity}+ discounts ${tier.percentOff}%, which is not ` +
          `more than the ${tiers[i - 1].minQuantity}+ tier's ${tiers[i - 1].percentOff}%. ` +
          `Buying more must never cost more per unit.`
      )
    }
  })

  return tiers
}

export default async function seedTradePricing({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pricing = container.resolve(Modules.PRICING)
  const customer = container.resolve(Modules.CUSTOMER)

  const tiers = parseTiers()

  logger.info(
    `${APPLY ? "APPLYING" : "DRY RUN"} — tiers: ${tiers
      .map((t) => `${t.minQuantity}+ → -${t.percentOff}%`)
      .join(", ")}`
  )

  // ── 1. Flat Trade customer group ──────────────────────────────────────
  const { data: existingGroups } = await query.graph({
    entity: "customer_group",
    fields: ["id", "name"],
    filters: { name: TRADE_GROUP_NAME },
  })

  if (existingGroups.length) {
    logger.info(`Customer group "${TRADE_GROUP_NAME}" already exists — skipping`)
  } else if (APPLY) {
    await customer.createCustomerGroups({ name: TRADE_GROUP_NAME })
    logger.info(`Created customer group "${TRADE_GROUP_NAME}"`)
  } else {
    logger.info(`Would create customer group "${TRADE_GROUP_NAME}"`)
  }

  // ── 2. Resolve target variants ────────────────────────────────────────
  const handles = (process.env.CATEGORY_HANDLES || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)

  let categoryIds: string[] | null = null

  if (handles.length) {
    // Walk down from each named category so tiers cover the whole subtree —
    // `category_id` is an exact match on products, never a subtree query.
    const { data: roots } = await query.graph({
      entity: "product_category",
      fields: ["id", "handle"],
      filters: { handle: handles },
    })

    if (!roots.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No categories matched handles: ${handles.join(", ")}`
      )
    }

    const { data: allCategories } = await query.graph({
      entity: "product_category",
      fields: ["id", "parent_category_id"],
    })

    const collected = new Set<string>(roots.map((c: any) => c.id))
    let grew = true
    while (grew) {
      grew = false
      for (const cat of allCategories as any[]) {
        if (
          cat.parent_category_id &&
          collected.has(cat.parent_category_id) &&
          !collected.has(cat.id)
        ) {
          collected.add(cat.id)
          grew = true
        }
      }
    }
    categoryIds = [...collected]
    logger.info(
      `Scoped to ${handles.length} category root(s) → ${categoryIds.length} categories incl. descendants`
    )
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "variants.id",
      "variants.title",
      "variants.price_set.id",
      "variants.price_set.prices.id",
      "variants.price_set.prices.amount",
      "variants.price_set.prices.currency_code",
      "variants.price_set.prices.min_quantity",
      "variants.price_set.prices.price_list_id",
    ],
    ...(categoryIds ? { filters: { categories: { id: categoryIds } } } : {}),
  })

  logger.info(`${products.length} product(s) in scope`)

  // ── 3. Build tier prices ──────────────────────────────────────────────
  let created = 0
  let skipped = 0
  const samples: string[] = []

  for (const product of products as any[]) {
    for (const variant of product.variants ?? []) {
      const priceSet = variant.price_set
      if (!priceSet?.id) continue

      const allPrices = priceSet.prices ?? []

      // Base price = the row with no quantity constraint and no price list.
      const basePrices = allPrices.filter(
        (p: any) => !p.min_quantity && !p.price_list_id
      )
      if (!basePrices.length) continue

      // Existing tiers, so re-running is idempotent rather than duplicating.
      const existingTierQtys = new Set(
        allPrices
          .filter((p: any) => p.min_quantity && !p.price_list_id)
          .map((p: any) => Number(p.min_quantity))
      )

      for (const base of basePrices) {
        for (const tier of tiers) {
          if (existingTierQtys.has(tier.minQuantity)) {
            skipped++
            continue
          }

          const amount =
            Math.round(
              Number(base.amount) * (1 - tier.percentOff / 100) * 100
            ) / 100

          if (samples.length < 8) {
            samples.push(
              `  ${product.title} / ${variant.title ?? "default"} — ` +
                `${tier.minQuantity}+ @ ${amount} ${base.currency_code} ` +
                `(base ${base.amount})`
            )
          }

          if (APPLY) {
            await pricing.addPrices({
              priceSetId: priceSet.id,
              prices: [
                {
                  amount,
                  currency_code: base.currency_code,
                  min_quantity: tier.minQuantity,
                },
              ],
            })
          }
          created++
        }
      }
    }
  }

  logger.info(
    `${APPLY ? "Created" : "Would create"} ${created} tier price(s); ` +
      `${skipped} already present`
  )
  if (samples.length) {
    logger.info("Sample:\n" + samples.join("\n"))
  }
  if (!APPLY) {
    logger.info("DRY RUN — nothing written. Re-run with APPLY=true to persist.")
  }
}
