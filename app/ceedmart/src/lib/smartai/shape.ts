// Pure rules for the SmartAI shopping tools (docs/smartai-shopping-mcp-design.md).
// No container: lib/smartai/catalog.ts fetches the rows, these decide.

import type { CommerceType } from "../order-categorization/types"

export type CatalogVariant = {
  id: string
  manage_inventory: boolean
  allow_backorder: boolean
  /** Option values in the product's option order, e.g. ["1 Carton(20 Pieces)"]. */
  option_values: string[]
  /** What the shopper pays for one unit in the location's state, naira. */
  price: number | null
  /** Units available to the location's channel (null when not tracked). */
  stock: number | null
  /** Sold in the location's state (lib/location-catalog). */
  available_here: boolean
  commerce_type: CommerceType
  policy_active: boolean
}

export type CatalogProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  description: string | null
  category: string | null
  variants: CatalogVariant[]
}

export type SmartaiProduct = {
  product_id: string
  name: string
  price: number
  currency: "NGN"
  category?: string
  image_url?: string
  available_sizes: string[]
  in_stock: boolean
  product_url?: string
  description?: string
}

export type SmartaiCartItem = {
  product_id: string
  name: string
  size?: string
  quantity: number
  unit_price: number
  line_total: number
  image_url?: string
}

export type SmartaiCart = {
  item_count: number
  subtotal: number
  currency: "NGN"
  items: SmartaiCartItem[]
  /** Opens this cart on ceedmart.com to pay (design §5). */
  checkout_url?: string
}

export type SmartaiErrorCode =
  | "unknown_product"
  | "not_purchasable"
  | "not_available_here"
  | "out_of_stock"
  | "insufficient_stock"
  | "bad_size"
  | "size_required"
  | "not_in_cart"
  | "bad_quantity"

export type SmartaiError = { code: SmartaiErrorCode; message: string }

// ── Text ────────────────────────────────────────────────────────────────

export const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim()

/** Plain text, at most `max` characters, cut at a word where possible. */
export const plainText = (html: string | null | undefined, max = 500): string | undefined => {
  if (!html) return undefined
  const text = html
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h\d)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return undefined
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…"
}

// ── Sizes ───────────────────────────────────────────────────────────────

const DEFAULT_OPTION = /^default( option| variant)?$/i

/**
 * A variant's size label: its option values joined, e.g. "1 Carton(20 Pieces)"
 * or "Black / 128GB". Option values are unique per product in Medusa; variant
 * titles are not, so titles are never used.
 */
export const sizeLabel = (variant: Pick<CatalogVariant, "option_values">): string =>
  variant.option_values
    .map((v) => v.trim())
    .filter((v) => v && !DEFAULT_OPTION.test(v))
    .join(" / ")

/** A product with one variant has nothing to choose. */
export const hasSizes = (product: Pick<CatalogProduct, "variants">) => product.variants.length > 1

export type VariantMatch =
  | { variant: CatalogVariant }
  | { error: SmartaiError }

/** product + size (from the model) → variant. Exact label, then loose; never fuzzy. */
export const matchVariant = (
  product: CatalogProduct,
  size: string | null | undefined
): VariantMatch => {
  if (!hasSizes(product)) return { variant: product.variants[0] }
  const offered = product.variants.map((v) => sizeLabel(v)).filter(Boolean)
  const list = offered.join(", ")
  if (!size || !size.trim()) {
    return {
      error: {
        code: "bad_size",
        message: `${product.title} comes in several sizes: ${list}. Which one would you like?`,
      },
    }
  }
  const exact = product.variants.find((v) => sizeLabel(v) === size)
  if (exact) return { variant: exact }
  const loose = (s: string) => norm(s).replace(/\s*([()/])\s*/g, "$1")
  const found = product.variants.filter((v) => loose(sizeLabel(v)) === loose(size))
  if (found.length === 1) return { variant: found[0] }
  return {
    error: {
      code: "bad_size",
      message: `${product.title} is not available as "${size}". Sizes: ${list}.`,
    },
  }
}

// ── Purchasable ─────────────────────────────────────────────────────────

/** The storefront's stock rule: untracked, backorderable, or enough on hand. */
export const hasStock = (v: CatalogVariant, quantity = 1) =>
  !v.manage_inventory || v.allow_backorder || (v.stock ?? 0) >= quantity

/** Can this variant be bought through chat at the location? */
export const purchasable = (v: CatalogVariant) =>
  v.commerce_type === "standard" &&
  v.policy_active &&
  v.available_here &&
  v.price != null &&
  hasStock(v)

/**
 * Why a variant cannot be added, as the shopper should hear it — or null when
 * it can. `quantity` is the line's quantity after the change.
 */
export const refusal = (
  product: CatalogProduct,
  v: CatalogVariant,
  quantity: number,
  stateName: string
): SmartaiError | null => {
  const what = hasSizes(product) ? `${product.title} (${sizeLabel(v)})` : product.title
  if (v.commerce_type !== "standard" || !v.policy_active) {
    const kind =
      v.commerce_type === "preorder"
        ? "a pre-order"
        : v.commerce_type === "auction"
          ? "an auction item"
          : v.commerce_type === "custom_build"
            ? "a custom build"
            : "not on sale"
    return {
      code: "not_purchasable",
      message: `${what} is ${kind}, so it can't be added here. It can be ordered on ceedmart.com.`,
    }
  }
  if (!v.available_here) {
    return { code: "not_available_here", message: `${what} is not available in ${stateName}.` }
  }
  if (v.price == null) {
    return { code: "not_purchasable", message: `${what} has no price yet, so it can't be added.` }
  }
  if (!hasStock(v)) {
    return { code: "out_of_stock", message: `${what} is out of stock in ${stateName}.` }
  }
  if (!hasStock(v, quantity)) {
    const n = Math.max(0, Math.floor(v.stock ?? 0))
    return {
      code: "insufficient_stock",
      message: `Only ${n} of ${what} ${n === 1 ? "is" : "are"} available in ${stateName}.`,
    }
  }
  return null
}

// ── Product shape ───────────────────────────────────────────────────────

/** SmartAI's Product, or null when nothing in it can be bought via chat. */
export const toSmartaiProduct = (
  p: CatalogProduct,
  storefrontUrl: string | null
): SmartaiProduct | null => {
  const buyable = p.variants.filter(purchasable)
  if (!buyable.length) return null
  const price = Math.min(...buyable.map((v) => v.price as number))
  const out: SmartaiProduct = {
    product_id: p.id,
    name: p.title,
    price,
    currency: "NGN",
    available_sizes: hasSizes(p) ? buyable.map((v) => sizeLabel(v)).filter(Boolean) : [],
    in_stock: true,
  }
  if (p.category) out.category = p.category
  if (p.thumbnail) out.image_url = p.thumbnail
  if (storefrontUrl && p.handle) {
    out.product_url = `${storefrontUrl.replace(/\/$/, "")}/ng/products/${p.handle}`
  }
  const description = plainText(p.description)
  if (description) out.description = description
  return out
}

// ── Search helpers ──────────────────────────────────────────────────────

const STOP = new Set(["a", "an", "the", "of", "for", "and", "with", "in", "to", "on", "some", "me"])

/** Words worth searching for, at most five. */
export const searchWords = (query: string): string[] =>
  [...new Set(norm(query).split(/[^a-z0-9.%]+/).filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 5)

/** Higher is better: words in the title count most, then anywhere. */
export const relevance = (p: Pick<CatalogProduct, "title" | "description">, words: string[], query: string) => {
  const title = norm(p.title)
  const body = norm(p.description)
  let score = title.includes(norm(query)) ? 10 : 0
  for (const w of words) {
    if (title.includes(w)) score += 3
    else if (body.includes(w)) score += 1
  }
  return score
}

export type SortBy = "relevance" | "price_asc" | "price_desc" | "popular"

export const filterAndSort = (
  products: SmartaiProduct[],
  opts: {
    min_price?: number | null
    max_price?: number | null
    sort_by?: string | null
    /** product id → units sold, for "popular". */
    popularity?: Map<string, number>
  }
): SmartaiProduct[] => {
  const min = Number.isFinite(opts.min_price as number) ? (opts.min_price as number) : null
  const max = Number.isFinite(opts.max_price as number) ? (opts.max_price as number) : null
  const kept = products.filter(
    (p) => (min == null || p.price >= min) && (max == null || p.price <= max)
  )
  const sort = opts.sort_by as SortBy
  if (sort === "price_asc") return [...kept].sort((a, b) => a.price - b.price)
  if (sort === "price_desc") return [...kept].sort((a, b) => b.price - a.price)
  if (sort === "popular" && opts.popularity?.size) {
    const pop = opts.popularity
    // Stable: equal sales keep their relevance order.
    return kept
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (pop.get(b.p.product_id) ?? 0) - (pop.get(a.p.product_id) ?? 0) || a.i - b.i)
      .map((x) => x.p)
  }
  return kept
}

// ── Categories ──────────────────────────────────────────────────────────

export type CategoryRow = { id: string; name: string; mpath: string | null }

/**
 * Category ids (with all descendants) a text names: exact name first, then
 * names containing the text or contained in it. Empty when nothing matches,
 * so a hint that matches nothing is ignored rather than emptying results.
 */
export const matchCategoryIds = (categories: CategoryRow[], text: string | null | undefined): string[] => {
  const t = norm(text).replace(/&/g, "and")
  if (!t) return []
  const name = (c: CategoryRow) => norm(c.name).replace(/&/g, "and")
  let roots = categories.filter((c) => name(c) === t)
  if (!roots.length) roots = categories.filter((c) => name(c).includes(t) || (t.length >= 4 && t.includes(name(c))))
  if (!roots.length) {
    // "solar" → "Solar Energy"; "phones" → "IPhone": any word overlap.
    const words = t.split(" ").filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ""))
    roots = categories.filter((c) => words.some((w) => name(c).includes(w)))
  }
  const ids = new Set<string>()
  for (const r of roots) {
    for (const c of categories) {
      const path = c.mpath ?? ""
      if (c.id === r.id || path.split(".").includes(r.id)) ids.add(c.id)
    }
  }
  return [...ids]
}

// ── Cart shape ──────────────────────────────────────────────────────────

export type CartLine = {
  id: string
  product_id: string | null
  variant_id: string | null
  product_title: string | null
  title: string | null
  thumbnail: string | null
  quantity: number
  unit_price: number
  subtotal: number
  /** Option values of the line's variant, for its size label. */
  option_values: string[]
  /** The product has more than one variant. */
  multi_variant: boolean
}

/** Plain number from a number, numeric string, or Medusa BigNumber. */
export const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "string") return Number(v) || 0
  if (v && typeof v === "object") {
    const o = v as any
    // BigNumber: `numeric` getter; raw form: { value }; else its JSON form.
    const n = Number(o.numeric ?? o.value ?? (typeof o.toJSON === "function" ? o.toJSON() : NaN))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export const EMPTY_CART: SmartaiCart = { item_count: 0, subtotal: 0, currency: "NGN", items: [] }

export const toSmartaiCart = (
  lines: CartLine[],
  itemSubtotal: unknown,
  checkoutUrl?: string
): SmartaiCart => {
  const items = lines.map((l) => {
    const item: SmartaiCartItem = {
      product_id: l.product_id ?? "",
      name: l.product_title ?? l.title ?? "",
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      line_total: num(l.subtotal),
    }
    const size = l.multi_variant ? sizeLabel({ option_values: l.option_values }) : ""
    if (size) item.size = size
    if (l.thumbnail) item.image_url = l.thumbnail
    return item
  })
  const cart: SmartaiCart = {
    item_count: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: num(itemSubtotal),
    currency: "NGN",
    items,
  }
  if (checkoutUrl && items.length) cart.checkout_url = checkoutUrl
  return cart
}

/** Lines of the cart for this product (and size, when given). */
export const linesFor = (
  lines: CartLine[],
  productId: string,
  size: string | null | undefined
): { lines: CartLine[] } | { error: SmartaiError } => {
  const mine = lines.filter((l) => l.product_id === productId)
  if (!mine.length) {
    return { error: { code: "not_in_cart", message: "That item is not in the cart." } }
  }
  if (size && size.trim()) {
    const want = norm(size).replace(/\s*([()/])\s*/g, "$1")
    const hit = mine.filter(
      (l) => norm(sizeLabel({ option_values: l.option_values })).replace(/\s*([()/])\s*/g, "$1") === want
    )
    if (!hit.length) {
      return {
        error: { code: "not_in_cart", message: `${mine[0].product_title ?? "That item"} in size "${size}" is not in the cart.` },
      }
    }
    return { lines: hit }
  }
  if (mine.length > 1) {
    const sizes = mine.map((l) => sizeLabel({ option_values: l.option_values })).join(", ")
    return {
      error: {
        code: "size_required",
        message: `The cart has ${mine[0].product_title ?? "this item"} in several sizes (${sizes}). Which size?`,
      },
    }
  }
  return { lines: mine }
}
