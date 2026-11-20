import type { MedusaContainer } from "@medusajs/framework/types"
import {
  channelProductIds,
  getShopLocation,
  listCategories,
  loadCatalog,
  newestProductIds,
  productIdsInCategories,
  productIdsMatching,
  smartaiConfig,
  taggedProductIds,
  unitsSold,
} from "./catalog"
import {
  filterAndSort,
  matchCategoryIds,
  norm,
  relevance,
  searchWords,
  SmartaiProduct,
  toSmartaiProduct,
} from "./shape"

// get_initial_recommendations and search_products
// (docs/smartai-shopping-mcp-design.md §2.6).

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Load in order and keep what can be bought, until `limit` are found. */
const firstBuyable = async (
  container: MedusaContainer,
  ids: string[],
  limit: number
): Promise<SmartaiProduct[]> => {
  const loc = await getShopLocation(container)
  const { storefrontUrl } = smartaiConfig()
  const out: SmartaiProduct[] = []
  const BATCH = 30
  for (let i = 0; i < ids.length && out.length < limit; i += BATCH) {
    const batch = await loadCatalog(container, loc, ids.slice(i, i + BATCH))
    for (const p of batch) {
      const shaped = toSmartaiProduct(p, storefrontUrl)
      if (shaped) out.push(shaped)
      if (out.length >= limit) break
    }
  }
  return out
}

export const getInitialRecommendations = async (
  container: MedusaContainer,
  args: { limit?: unknown; category_hint?: unknown }
): Promise<{ products: SmartaiProduct[] }> => {
  const limit = clampInt(args.limit, 1, 6, 4)
  const loc = await getShopLocation(container)
  const { recommendTag } = smartaiConfig()

  const [listed, categories, tagged] = await Promise.all([
    channelProductIds(container, loc),
    listCategories(container),
    taggedProductIds(container, recommendTag),
  ])
  const hintIds = matchCategoryIds(categories, typeof args.category_hint === "string" ? args.category_hint : null)
  const inHint = hintIds.length ? await productIdsInCategories(container, hintIds) : null

  const pick = async (scope: Set<string> | null) => {
    const pool = listed.filter((id) => !scope || scope.has(id))
    const newest = await newestProductIds(container, pool, 120)
    // Featured first (newest of them first), then the newest of the rest.
    const ordered = [...newest.filter((id) => tagged.has(id)), ...newest.filter((id) => !tagged.has(id))]
    return firstBuyable(container, ordered, limit)
  }

  let products = await pick(inHint)
  // A hint that leaves nothing buyable is ignored rather than returning empty.
  if (!products.length && inHint) products = await pick(null)
  return { products }
}

export const searchProducts = async (
  container: MedusaContainer,
  args: {
    query?: unknown
    category?: unknown
    color?: unknown
    min_price?: unknown
    max_price?: unknown
    sort_by?: unknown
  }
): Promise<{ products: SmartaiProduct[]; total: number }> => {
  const query = typeof args.query === "string" ? args.query : ""
  const loc = await getShopLocation(container)
  const [listed, categories] = await Promise.all([
    channelProductIds(container, loc),
    listCategories(container),
  ])

  // Narrow by category when one matches; an unknown category is ignored.
  const catIds = matchCategoryIds(categories, typeof args.category === "string" ? args.category : null)
  const inCat = catIds.length ? await productIdsInCategories(container, catIds) : null
  const pool = listed.filter((id) => !inCat || inCat.has(id))

  // One text search per meaningful word; prefer products matching every word.
  const words = searchWords(query)
  const terms = words.length ? words : norm(query) ? [norm(query)] : []
  let candidates: string[]
  if (terms.length) {
    const hits = await Promise.all(terms.map((w) => productIdsMatching(container, pool, w)))
    const count = new Map<string, number>()
    for (const ids of hits) for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1)
    const best = Math.max(0, ...count.values())
    // Every word when something matches them all; else at least half, so
    // one stray word ("warp drive inverter") does not pull in a category.
    const need = best === terms.length ? terms.length : Math.max(1, Math.ceil(terms.length / 2))
    candidates = [...count.entries()]
      .filter(([, n]) => n >= need)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
  } else {
    // No words (e.g. only a category): the newest in scope.
    candidates = await newestProductIds(container, pool, 60)
  }
  candidates = candidates.slice(0, 80)

  const { storefrontUrl } = smartaiConfig()
  const catalog = await loadCatalog(container, loc, candidates)
  const scored = catalog
    .map((p, i) => ({ p, i, shaped: toSmartaiProduct(p, storefrontUrl) }))
    .filter((x): x is typeof x & { shaped: SmartaiProduct } => !!x.shaped)
    .map((x) => ({ ...x, score: terms.length ? relevance(x.p, terms, query) : 0 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.shaped)

  const sortBy = typeof args.sort_by === "string" ? args.sort_by : "relevance"
  const popularity =
    sortBy === "popular" ? await unitsSold(container, scored.map((p) => p.product_id)) : undefined
  const results = filterAndSort(scored, {
    min_price: numOrNull(args.min_price),
    max_price: numOrNull(args.max_price),
    sort_by: sortBy,
    popularity,
  })
  // color is accepted and ignored in v1: no colour data on most products.
  return { products: results.slice(0, 10), total: results.length }
}
