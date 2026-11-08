import {
  addOrderLineItemsWorkflow,
  addToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createOrderWorkflow,
  refreshCartItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  loadCartForProvince,
  normalizeProvince,
  PROVINCE_ATTRIBUTE,
  resolveSalesChannelProvince,
} from "../../lib/locations"
import { assertVariantsAvailable } from "../../lib/location-catalog/runtime"

// Location pricing and availability on every cart, through Medusa's own
// workflow hooks rather than route patches, so the storefront, the mobile
// app, the PoS and anything else that drives these workflows get the same
// prices and the same refusals.
//
// setPricingContext adds `province` to the pricing context; the engine then
// prefers the variant's province price (lib/location-catalog). validate
// refuses variants marked unavailable in the cart's state.
//
// Each hook accepts exactly one handler, so these are the only handlers for
// them in the project.

const provinceContext = (province: string | null) =>
  new StepResponse(province ? { [PROVINCE_ATTRIBUTE]: province } : {})

// ── Pricing ─────────────────────────────────────────────────────────────

// Cart creation only sees the channel; the client's chosen state is in
// metadata, which this hook is not given. A PoS cart is priced right here
// from its shop channel; a web cart created with items is re-priced in
// cartCreated below.
createCartWorkflow.hooks.setPricingContext(
  async ({ salesChannel }, { container }) =>
    provinceContext(
      await resolveSalesChannelProvince(container, (salesChannel as any)?.id)
    )
)

addToCartWorkflow.hooks.setPricingContext(async ({ cart }, { container }) =>
  provinceContext(await loadCartForProvince(container, (cart as any).id))
)

updateLineItemInCartWorkflow.hooks.setPricingContext(
  async ({ cart }, { container }) =>
    provinceContext(await loadCartForProvince(container, (cart as any).id))
)

// Runs on every cart update, including the client switching state, so the
// lines are re-priced for the new state.
refreshCartItemsWorkflow.hooks.setPricingContext(
  async ({ cart_id }, { container }) =>
    provinceContext(await loadCartForProvince(container, cart_id))
)

// PoS draft orders add their lines through this workflow. The order's
// channel is the shop, and the shop's state prices the line.
addOrderLineItemsWorkflow.hooks.setPricingContext(
  async ({ order }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "sales_channel_id"],
      filters: { id: (order as any).id },
    })
    return provinceContext(
      await resolveSalesChannelProvince(container, (data as any[])[0]?.sales_channel_id)
    )
  }
)

// A draft order created with its lines (POST /admin/draft-orders). The
// route middleware puts the shop's state in additional_data, since this
// hook is not given the channel (lib/location-catalog/http).
createOrderWorkflow.hooks.setPricingContext(async ({ additional_data }) =>
  provinceContext(normalizeProvince((additional_data as any)?.[PROVINCE_ATTRIBUTE]))
)

createCartWorkflow.hooks.cartCreated(async ({ cart }, { container }) => {
  // The hook's cart is the bare created record, without items; read it back.
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata", "sales_channel_id", "items.id"],
    filters: { id: (cart as any).id },
  })
  const c = (data as any[])[0]
  const chosen = normalizeProvince(c?.metadata?.ceedmart?.province)
  if (!chosen || !c.items?.length) return
  const channelProvince = await resolveSalesChannelProvince(container, c.sales_channel_id)
  if (chosen === channelProvince) return
  await refreshCartItemsWorkflow(container).run({
    input: { cart_id: c.id, force_refresh: true },
  })
})

// ── Availability ────────────────────────────────────────────────────────

const variantIdsOf = (items: any[] | null | undefined): string[] =>
  (items ?? []).map((i) => i?.variant_id).filter(Boolean)

createCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  const i = input as any
  const province =
    normalizeProvince(i.metadata?.ceedmart?.province) ??
    (await resolveSalesChannelProvince(container, i.sales_channel_id))
  await assertVariantsAvailable(container, variantIdsOf(i.items), province)
})

addToCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  await assertVariantsAvailable(
    container,
    variantIdsOf((input as any).items),
    await loadCartForProvince(container, (cart as any).id)
  )
})

// The last word: catches a cart filled in one state and checked out in
// another, and anything added by a path that skipped the checks above.
completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const c = cart as any
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.variant_id"],
    filters: { id: c.id },
  })
  await assertVariantsAvailable(
    container,
    variantIdsOf((data as any[])[0]?.items),
    await loadCartForProvince(container, c.id)
  )
})
