import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  loadCartForProvince,
  normalizeProvince,
  PROVINCE_ATTRIBUTE,
  provinceName,
  resolveSalesChannelProvince,
} from "../locations"
import { assertVariantsAvailable, loadAvailability } from "./runtime"

// Route middlewares for location pricing and availability. Registered in
// api/middlewares.ts after Medusa's own, so the pricing context they extend
// already exists.

const first = (v: unknown): string | undefined =>
  Array.isArray(v) ? (v[0] as string) : typeof v === "string" ? v : undefined

/**
 * The state a store read is for: an explicit `province` (the standard store
 * products query parameter, also used for tax), else the location channel
 * the storefront and app already send as `sales_channel_id`.
 */
const provinceOfStoreRequest = async (req: MedusaRequest) =>
  normalizeProvince(first(req.query.province)) ??
  (await resolveSalesChannelProvince(req.scope, first(req.query.sales_channel_id)))

/**
 * GET /store/products, /store/products/:id, /store/product-variants…
 *
 * Prices each variant for the state, and marks it `available_here`. A
 * product is `available_here` when any variant is, so a listing can show
 * the whole card as unavailable when none can be bought.
 */
export const storeLocationCatalog = async (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  let province: string | null
  try {
    province = await provinceOfStoreRequest(req)
  } catch (e) {
    return next(e)
  }
  if (!province) return next()

  const pricingContext = (req as any).pricingContext
  if (pricingContext) pricingContext[PROVINCE_ATTRIBUTE] = province

  const originalJson = res.json.bind(res)
  res.json = ((body: any) => {
    annotate(req, body, province!)
      .catch((e) => {
        req.scope
          .resolve(ContainerRegistrationKeys.LOGGER)
          .warn(`[location-catalog] availability not annotated: ${e?.message ?? e}`)
      })
      .finally(() => originalJson(body))
    return res
  }) as typeof res.json

  return next()
}

const annotate = async (req: MedusaRequest, body: any, province: string) => {
  const products: any[] = body?.products ?? (body?.product ? [body.product] : [])
  const looseVariants: any[] =
    body?.variants ?? (body?.variant ? [body.variant] : [])

  const targets: { variantId: string; productId: string }[] = []
  for (const p of products) {
    for (const v of p.variants ?? []) targets.push({ variantId: v.id, productId: p.id })
  }
  for (const v of looseVariants) {
    const productId = v.product_id ?? v.product?.id
    if (productId) targets.push({ variantId: v.id, productId })
  }
  if (!targets.length) return

  const availability = await loadAvailability(req.scope, targets, province)
  const location = { province, name: provinceName(province) }

  for (const p of products) {
    const variants: any[] = p.variants ?? []
    for (const v of variants) v.available_here = availability.get(v.id) !== false
    if (variants.length) p.available_here = variants.some((v) => v.available_here)
    p.location = location
  }
  for (const v of looseVariants) {
    if (availability.has(v.id)) v.available_here = availability.get(v.id) !== false
  }
}

// ── PoS draft orders ────────────────────────────────────────────────────
// Draft orders have no validate hook, so the PoS's two ways of adding a
// line are checked at the route. The state is the draft's shop channel.

const draftOrderChannel = async (req: MedusaRequest, id: string) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "sales_channel_id"],
    filters: { id },
  })
  return (data as any[])[0]?.sales_channel_id as string | undefined
}

export const draftOrderAvailability = async (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  try {
    const body = ((req as any).validatedBody ?? req.body ?? {}) as any
    const items: any[] = body.items ?? []
    const variantIds = items.map((i) => i?.variant_id).filter(Boolean)
    if (!variantIds.length) return next()

    const channelId = req.params.id
      ? await draftOrderChannel(req, req.params.id)
      : body.sales_channel_id
    const province = await resolveSalesChannelProvince(req.scope, channelId)
    await assertVariantsAvailable(req.scope, variantIds, province)

    // A draft created with its items is priced by createOrderWorkflow, whose
    // pricing hook is not told the channel. The route forwards
    // additional_data to the workflow, so the shop's state rides along there
    // (read in workflows/hooks/location-catalog). The PoS itself creates
    // drafts empty and adds lines through the edit flow, priced by
    // addOrderLineItemsWorkflow's hook instead.
    if (!req.params.id && province && (req as any).validatedBody) {
      const vb = (req as any).validatedBody
      vb.additional_data = { ...(vb.additional_data ?? {}), [PROVINCE_ATTRIBUTE]: province }
    }
    return next()
  } catch (e) {
    return next(e)
  }
}

/**
 * Every store cart response: each line is marked `available_here` and the
 * cart carries `location`, so a client can flag a line that became
 * unavailable when the shopper switched state, before checkout refuses it.
 */
export const storeCartLocation = async (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const originalJson = res.json.bind(res)
  res.json = ((body: any) => {
    annotateCart(req, body?.cart)
      .catch((e) => {
        req.scope
          .resolve(ContainerRegistrationKeys.LOGGER)
          .warn(`[location-catalog] cart not annotated: ${e?.message ?? e}`)
      })
      .finally(() => originalJson(body))
    return res
  }) as typeof res.json
  return next()
}

const annotateCart = async (req: MedusaRequest, cart: any) => {
  if (!cart?.id) return
  const province = await loadCartForProvince(req.scope, cart.id)
  if (!province) return
  cart.location = { province, name: provinceName(province) }

  const items: any[] = (cart.items ?? []).filter(
    (i: any) => i.variant_id && i.product_id
  )
  if (!items.length) return
  const availability = await loadAvailability(
    req.scope,
    items.map((i) => ({ variantId: i.variant_id, productId: i.product_id })),
    province
  )
  for (const i of items) i.available_here = availability.get(i.variant_id) !== false
}
