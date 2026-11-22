import type { MedusaContainer } from "@medusajs/framework/types"
import {
  addToCartWorkflow,
  createCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { SMARTAI_MODULE } from "../../modules/smartai"
import { channelProductIds, getShopLocation, loadCatalog, ShopLocation, smartaiConfig } from "./catalog"
import {
  CartLine,
  CatalogProduct,
  EMPTY_CART,
  linesFor,
  matchVariant,
  refusal,
  SmartaiCart,
  SmartaiError,
  toSmartaiCart,
} from "./shape"

// manage_cart (docs/smartai-shopping-mcp-design.md §2.3, §2.6).
//
// One guest cart per SmartAI shopper, recorded in smartai_shopper_cart. Every
// change goes through Medusa's cart workflows, so the location-catalog hooks
// price the cart for its state and refuse what cannot be sold there.

export type CartResult = { cart: SmartaiCart; error?: SmartaiError }

type LiveCart = { id: string; lines: CartLine[]; itemSubtotal: unknown }

const ACTIONS = ["ADD", "REMOVE", "UPDATE_QUANTITY", "VIEW", "CLEAR"] as const
type Action = (typeof ACTIONS)[number]

/** A bad call (not a store outcome): the route answers 400, the MCP an error. */
export class SmartaiBadRequest extends Error {}

export const checkoutUrl = (cartId: string) => {
  const { storefrontUrl } = smartaiConfig()
  return storefrontUrl ? `${storefrontUrl}/ng/cart/continue?cart=${encodeURIComponent(cartId)}` : undefined
}

// ── Shopper → cart ──────────────────────────────────────────────────────

const mappingFor = async (container: MedusaContainer, shopperId: string) => {
  const svc: any = container.resolve(SMARTAI_MODULE)
  const [row] = await svc.listShopperCarts({ shopper_id: shopperId }, { take: 1 })
  return row ?? null
}

/** The cart with its lines, or null when it is gone or already checked out. */
const loadLiveCart = async (
  container: MedusaContainer,
  loc: ShopLocation,
  cartId: string
): Promise<LiveCart | null> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "item_subtotal",
      "items.id",
      "items.product_id",
      "items.variant_id",
      "items.product_title",
      "items.title",
      "items.thumbnail",
      "items.quantity",
      "items.unit_price",
      "items.subtotal",
    ],
    filters: { id: cartId },
  })
  const cart = (data as any[])[0]
  if (!cart || cart.completed_at) return null

  const items = (cart.items ?? []) as any[]
  // Size labels and "has sizes" come from the catalogue, as for products.
  const catalog = await loadCatalog(
    container,
    loc,
    items.map((i) => i.product_id).filter(Boolean)
  )
  const productOf = new Map(catalog.map((p) => [p.id, p]))
  const lines: CartLine[] = items.map((i) => {
    const product = i.product_id ? productOf.get(i.product_id) : undefined
    const variant = product?.variants.find((v) => v.id === i.variant_id)
    return {
      id: i.id,
      product_id: i.product_id ?? null,
      variant_id: i.variant_id ?? null,
      product_title: i.product_title ?? null,
      title: i.title ?? null,
      thumbnail: i.thumbnail ?? null,
      quantity: Number(i.quantity) || 0,
      unit_price: i.unit_price,
      subtotal: i.subtotal,
      option_values: variant?.option_values ?? [],
      multi_variant: (product?.variants.length ?? 1) > 1,
    } as CartLine
  })
  return { id: cart.id, lines, itemSubtotal: cart.item_subtotal }
}

const currentCart = async (container: MedusaContainer, loc: ShopLocation, shopperId: string) => {
  const row = await mappingFor(container, shopperId)
  return row ? loadLiveCart(container, loc, row.cart_id) : null
}

const createGuestCart = async (container: MedusaContainer, loc: ShopLocation, shopperId: string) => {
  const { result } = await createCartWorkflow(container).run({
    input: {
      region_id: loc.regionId,
      sales_channel_id: loc.defaultChannelId,
      currency_code: "ngn",
      // A new cart: nothing to merge with. Other features add their own keys
      // under metadata.ceedmart later and must not be overwritten.
      metadata: { ceedmart: { province: loc.province, smartai_shopper_id: shopperId } },
    } as any,
  })
  return (result as any).id as string
}

/** The shopper's live cart, created now if there is none. */
const ensureCart = async (
  container: MedusaContainer,
  loc: ShopLocation,
  shopperId: string
): Promise<LiveCart> => {
  const svc: any = container.resolve(SMARTAI_MODULE)
  const row = await mappingFor(container, shopperId)
  if (row) {
    const live = await loadLiveCart(container, loc, row.cart_id)
    if (live) return live
  }

  const cartId = await createGuestCart(container, loc, shopperId)
  if (row) {
    await svc.updateShopperCarts({ id: row.id, cart_id: cartId })
  } else {
    try {
      await svc.createShopperCarts({ shopper_id: shopperId, cart_id: cartId })
    } catch (err) {
      // Another call for this shopper created the mapping first (unique
      // index): use its cart, leaving ours empty and unused.
      const winner = await mappingFor(container, shopperId)
      if (!winner) throw err
      const live = await loadLiveCart(container, loc, winner.cart_id)
      if (live) return live
      await svc.updateShopperCarts({ id: winner.id, cart_id: cartId })
    }
  }
  return { id: cartId, lines: [], itemSubtotal: 0 }
}

// ── Helpers ─────────────────────────────────────────────────────────────

const result = async (
  container: MedusaContainer,
  loc: ShopLocation,
  cartId: string | null,
  error?: SmartaiError
): Promise<CartResult> => {
  const live = cartId ? await loadLiveCart(container, loc, cartId) : null
  const cart = live ? toSmartaiCart(live.lines, live.itemSubtotal, checkoutUrl(live.id)) : EMPTY_CART
  return error ? { cart, error } : { cart }
}

const quantityError = (max: number): SmartaiError => ({
  code: "bad_quantity",
  message: `Quantities can be from 1 to ${max} here. For larger orders, use ceedmart.com or pick a carton size.`,
})

/** Medusa's own refusals (state availability, stock) as SmartAI error codes. */
const fromMedusaError = (err: unknown, loc: ShopLocation): SmartaiError | null => {
  if (!(err instanceof MedusaError) && !(err as any)?.type) return null
  const type = (err as any).type
  const message = String((err as any).message ?? "")
  if (/not available in/i.test(message)) return { code: "not_available_here", message }
  if (/stock|inventory/i.test(message)) {
    return {
      code: "insufficient_stock",
      message: `There isn't enough stock in ${loc.stateName} for that quantity.`,
    }
  }
  if (type === MedusaError.Types.NOT_ALLOWED) return { code: "not_purchasable", message }
  return null
}

const loadProduct = async (
  container: MedusaContainer,
  loc: ShopLocation,
  productId: string
): Promise<{ product: CatalogProduct } | { error: SmartaiError }> => {
  const [product] = await loadCatalog(container, loc, [productId])
  if (!product) {
    return { error: { code: "unknown_product", message: "That product isn't available any more." } }
  }
  const listed = new Set(await channelProductIds(container, loc))
  if (!listed.has(productId)) {
    return {
      error: { code: "not_available_here", message: `${product.title} is not available in ${loc.stateName}.` },
    }
  }
  return { product }
}

// ── Tool ────────────────────────────────────────────────────────────────

export const manageCart = async (
  container: MedusaContainer,
  shopperId: string,
  args: { action?: unknown; product_id?: unknown; size?: unknown; quantity?: unknown }
): Promise<CartResult> => {
  const action = String(args.action ?? "").toUpperCase() as Action
  if (!ACTIONS.includes(action)) {
    throw new SmartaiBadRequest(`action must be one of ${ACTIONS.join(", ")}`)
  }
  const loc = await getShopLocation(container)
  const { maxQuantity } = smartaiConfig()
  const productId = typeof args.product_id === "string" ? args.product_id.trim() : ""
  const size = typeof args.size === "string" ? args.size : null
  const hasQuantity = args.quantity !== undefined && args.quantity !== null && args.quantity !== ""
  const quantity = hasQuantity ? Number(args.quantity) : 1
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= maxQuantity

  if (action === "VIEW") {
    const live = await currentCart(container, loc, shopperId)
    return result(container, loc, live?.id ?? null)
  }

  if (action === "CLEAR") {
    const live = await currentCart(container, loc, shopperId)
    if (live?.lines.length) {
      await deleteLineItemsWorkflow(container).run({
        input: { cart_id: live.id, ids: live.lines.map((l) => l.id) },
      })
    }
    return result(container, loc, live?.id ?? null)
  }

  if (!productId) {
    throw new SmartaiBadRequest(`product_id is required for ${action}`)
  }

  if (action === "ADD") {
    if (!validQuantity) {
      const live = await currentCart(container, loc, shopperId)
      return result(container, loc, live?.id ?? null, quantityError(maxQuantity))
    }
    const found = await loadProduct(container, loc, productId)
    const before = await currentCart(container, loc, shopperId)
    if ("error" in found) return result(container, loc, before?.id ?? null, found.error)
    const match = matchVariant(found.product, size)
    if ("error" in match) return result(container, loc, before?.id ?? null, match.error)

    const existing = before?.lines.find((l) => l.variant_id === match.variant.id)
    const newQuantity = (existing?.quantity ?? 0) + quantity
    if (newQuantity > maxQuantity) {
      return result(container, loc, before?.id ?? null, quantityError(maxQuantity))
    }
    const refused = refusal(found.product, match.variant, newQuantity, loc.stateName)
    if (refused) return result(container, loc, before?.id ?? null, refused)

    const cart = await ensureCart(container, loc, shopperId)
    try {
      if (existing && cart.id === before?.id) {
        await updateLineItemInCartWorkflow(container).run({
          input: { cart_id: cart.id, item_id: existing.id, update: { quantity: newQuantity } },
        })
      } else {
        await addToCartWorkflow(container).run({
          input: { cart_id: cart.id, items: [{ variant_id: match.variant.id, quantity }] },
        })
      }
    } catch (err) {
      const mapped = fromMedusaError(err, loc)
      if (!mapped) throw err
      return result(container, loc, cart.id, mapped)
    }
    return result(container, loc, cart.id)
  }

  // REMOVE / UPDATE_QUANTITY act on lines already in the cart.
  const live = await currentCart(container, loc, shopperId)
  if (!live) {
    return result(container, loc, null, { code: "not_in_cart", message: "The cart is empty." })
  }
  const target = linesFor(live.lines, productId, size)
  if ("error" in target) return result(container, loc, live.id, target.error)

  if (action === "REMOVE") {
    await deleteLineItemsWorkflow(container).run({
      input: { cart_id: live.id, ids: target.lines.map((l) => l.id) },
    })
    return result(container, loc, live.id)
  }

  // UPDATE_QUANTITY
  if (!validQuantity) return result(container, loc, live.id, quantityError(maxQuantity))
  const line = target.lines[0]
  const [product] = await loadCatalog(container, loc, [productId])
  const variant = product?.variants.find((v) => v.id === line.variant_id)
  if (product && variant && quantity > line.quantity) {
    const refused = refusal(product, variant, quantity, loc.stateName)
    if (refused) return result(container, loc, live.id, refused)
  }
  try {
    await updateLineItemInCartWorkflow(container).run({
      input: { cart_id: live.id, item_id: line.id, update: { quantity } },
    })
  } catch (err) {
    const mapped = fromMedusaError(err, loc)
    if (!mapped) throw err
    return result(container, loc, live.id, mapped)
  }
  return result(container, loc, live.id)
}

/**
 * The shopper's chat cart for the app's "Checkout" button: its id, the link
 * that opens it on the website, and its size. Nulls when there is none.
 */
export const chatCartFor = async (
  container: MedusaContainer,
  shopperId: string
): Promise<{ cart_id: string | null; checkout_url: string | null; item_count: number }> => {
  const loc = await getShopLocation(container)
  const live = await currentCart(container, loc, shopperId)
  if (!live) return { cart_id: null, checkout_url: null, item_count: 0 }
  return {
    cart_id: live.id,
    checkout_url: checkoutUrl(live.id) ?? null,
    item_count: live.lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0),
  }
}

