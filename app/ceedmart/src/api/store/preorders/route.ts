import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../modules/preorder"
import {
  deliversTo,
  estimateBreakdown,
  estimatedDeliveryDate,
  isOfferSellable,
} from "../../../lib/preorder/estimate"
import { inclusionSummary } from "../../../lib/preorder/pricing"
import { FEATURE_FLAGS, assertEnabled } from "../../../lib/feature-flags"

// Public list of US pre-order offers (BRD §6.3, §9.1).
//
// Backs the "Pre-Order from the US" destination. Each row carries what a
// shopper needs to decide whether to open it — price, delivery window,
// condition — resolved for THEIR state where one is given, because §6.3
// requires the estimate be calculated for the customer's location and an
// offer may not cover every state.
//
// Product titles and thumbnails come from the catalogue rather than being
// duplicated onto the offer: an offer is a commercial wrapper around a
// listing, not a second copy of it.

const MAX_VERIFICATION_AGE_DAYS = Number(
  process.env.PREORDER_MAX_VERIFICATION_AGE_DAYS || 7
)

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.PREORDER)

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const state =
    typeof req.query.state === "string" ? req.query.state.trim() : null

  const str = (key: string): string | null => {
    const v = req.query[key]
    return typeof v === "string" && v.trim() ? v.trim() : null
  }
  const num = (key: string): number | null => {
    const v = Number(req.query[key])
    return Number.isFinite(v) ? v : null
  }

  const search = str("q")?.toLowerCase() ?? null
  const condition = str("condition")?.toLowerCase() ?? null
  const source = str("source")?.toLowerCase() ?? null
  const maxDays = num("max_days")
  const minPrice = num("min_price")
  const maxPrice = num("max_price")
  const sort = str("sort")

  const offers = await svc.listPreorderOffers(
    { is_active: true },
    { order: { created_at: "DESC" }, take: Number(req.query.limit) || 50 }
  )

  // Resolve the listings these offers wrap, in two batched reads.
  const productIds = (offers as any[]).map((o) => o.product_id).filter(Boolean)
  const variantIds = (offers as any[]).map((o) => o.variant_id).filter(Boolean)

  const [byProduct, byVariant] = await Promise.all([
    productIds.length
      ? query
          .graph({
            entity: "product",
            fields: ["id", "title", "handle", "thumbnail"],
            filters: { id: productIds },
          })
          .then(({ data }) => new Map((data as any[]).map((p) => [p.id, p])))
          .catch(() => new Map())
      : Promise.resolve(new Map()),
    variantIds.length
      ? query
          .graph({
            entity: "variant",
            fields: [
              "id",
              "title",
              "product.id",
              "product.title",
              "product.handle",
              "product.thumbnail",
            ],
            filters: { id: variantIds },
          })
          .then(({ data }) => new Map((data as any[]).map((v) => [v.id, v])))
          .catch(() => new Map())
      : Promise.resolve(new Map()),
  ])

  const rows = (offers as any[])
    .map((offer) => {
      const variant = offer.variant_id ? byVariant.get(offer.variant_id) : null
      const product = variant?.product ?? byProduct.get(offer.product_id)

      const sellable = isOfferSellable(offer, {
        maxVerificationAgeDays: MAX_VERIFICATION_AGE_DAYS,
      })
      const covered = deliversTo(offer.delivery_states, state)
      const breakdown = estimateBreakdown(offer)
      const inclusions = inclusionSummary(offer)

      return {
        id: offer.id,
        product_id: offer.product_id ?? product?.id ?? null,
        variant_id: offer.variant_id,
        // An offer whose listing has been deleted is not shoppable; filtered
        // out below rather than rendered as an untitled card.
        title: product?.title ?? null,
        handle: product?.handle ?? null,
        thumbnail: product?.thumbnail ?? null,
        variant_title: variant?.title ?? null,

        price: Number(offer.locked_price),
        currency_code: offer.currency_code,
        price_is_final: true,

        estimate_days: breakdown.totalDays,
        estimated_delivery_date: estimatedDeliveryDate(offer).toISOString(),

        includes: inclusions.included,
        excludes: inclusions.excluded,

        source_country_code: offer.source_country_code,
        condition: offer.condition,
        warranty_text: offer.warranty_text,
        offer_expires_at: offer.offer_expires_at,

        available: sellable.sellable && covered,
        unavailable_reason: !sellable.sellable
          ? sellable.reason
          : !covered
            ? "Doesn't ship to your state yet."
            : null,
      }
    })
    .filter((row) => row.title)

  // ── Search and filter ──────────────────────────────────────────────────
  // Done here rather than in the offer query because most of what a shopper
  // searches by does not live on the offer: the product title and variant
  // come from the catalogue and are only known once the two reads above have
  // resolved. Filtering in SQL would mean matching on ids we do not have yet.
  //
  // Safe at this size — the endpoint takes at most `limit` offers (50 by
  // default) — but it is the reason this is a filter over a page rather than
  // a search over everything. If the catalogue of offers grows past a few
  // hundred this needs to become a real index.
  const matches = (row: (typeof rows)[number]): boolean => {
    if (search) {
      // Everything a customer might reasonably type: what it is, which
      // variant, its condition, who covers the warranty, where it comes
      // from, and what the price includes.
      const haystack = [
        row.title,
        row.variant_title,
        row.condition,
        row.warranty_text,
        row.source_country_code,
        ...row.includes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      // Every word must appear somewhere, so "used inverter" narrows rather
      // than widening to everything used OR every inverter.
      const words = search.split(/\s+/).filter(Boolean)
      if (!words.every((w) => haystack.includes(w))) {
        return false
      }
    }

    if (condition && String(row.condition).toLowerCase() !== condition) {
      return false
    }
    if (source && String(row.source_country_code).toLowerCase() !== source) {
      return false
    }
    if (maxDays !== null && row.estimate_days > maxDays) {
      return false
    }
    // Prices arrive in naira from the query string and are stored in kobo.
    if (minPrice !== null && row.price < minPrice * 100) {
      return false
    }
    if (maxPrice !== null && row.price > maxPrice * 100) {
      return false
    }
    return true
  }

  const filtered = rows.filter(matches)

  // Unavailable offers sink regardless of sort — an item that cannot be
  // bought should not head a list someone is shopping.
  const bySort: Record<string, (a: any, b: any) => number> = {
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    fastest: (a, b) => a.estimate_days - b.estimate_days,
  }
  const compare = sort ? bySort[sort] : undefined
  if (compare) {
    filtered.sort(
      (a, b) => Number(b.available) - Number(a.available) || compare(a, b)
    )
  }

  // The facet values come from the unfiltered page, so choosing "Used" does
  // not make every other condition vanish from the picker.
  const facets = {
    conditions: [...new Set(rows.map((r) => r.condition).filter(Boolean))].sort(),
    sources: [
      ...new Set(rows.map((r) => r.source_country_code).filter(Boolean)),
    ].sort(),
    max_days: rows.reduce((m, r) => Math.max(m, r.estimate_days), 0),
    price_range: rows.length
      ? {
          min: Math.min(...rows.map((r) => r.price)),
          max: Math.max(...rows.map((r) => r.price)),
        }
      : null,
  }

  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
  res.json({
    preorders: filtered,
    count: filtered.length,
    total: rows.length,
    facets,
  })
}
