// Standardized order categorization metadata. Written under
// order.metadata.ceedmart by both the storefront (cart complete) and the
// POS (order capture). Read by the admin order-detail badge widget and
// any future ops reporting.
//
// Every completed order carries this block. Missing values are treated as
// unknown — never as a default, so we can distinguish "cashier didn't
// pick" from "cashier picked delivery" during rollout / analytics.

export type OrderChannel = "online" | "in-store"
export type OrderFulfillment = "pickup" | "delivery"
export type OrderSourcing = "local" | "cross-warehouse"

export type CeedmartOrderMetadata = {
  channel: OrderChannel
  // sales_channel_id of the physical shop. Set for in-store orders (POS)
  // and for online orders where the customer chose pickup at a specific
  // shop. Undefined for online delivery orders that ship from the
  // warehouse without a shop touchpoint.
  store_id?: string
  fulfillment: OrderFulfillment
  // "local" — every item was in stock at the sourcing location.
  // "cross-warehouse" — one or more items had to be pulled from a
  // fallback warehouse. Populated by the M1 workflow when it lands; H3
  // writes "local" as the safe default.
  sourcing: OrderSourcing
}

export const CEEDMART_METADATA_KEY = "ceedmart"

// Merge a Ceedmart metadata block into an order/cart metadata object
// without dropping unrelated top-level keys.
export const withCeedmartMetadata = (
  existing: Record<string, unknown> | null | undefined,
  ceedmart: CeedmartOrderMetadata
): Record<string, unknown> => {
  return {
    ...(existing ?? {}),
    [CEEDMART_METADATA_KEY]: ceedmart,
  }
}
