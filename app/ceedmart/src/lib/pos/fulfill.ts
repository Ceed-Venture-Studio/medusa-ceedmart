import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"

// Fulfil an order that has already been handed over.
//
// ── Why this exists ─────────────────────────────────────────────────────
// Medusa splits a sale in two. Placing an order creates a reservation:
// reserved_quantity goes up, stocked_quantity does not move, and
// available_quantity (computed as stocked − reserved) falls. Only creating
// a FULFILLMENT converts that reservation into a real stock movement — it
// adjusts the level by a negative amount and deletes the reservation.
//
// That split is right for a parcel, where payment and dispatch are days
// apart. At a till they are the same moment: the customer has the goods in
// a bag before the receipt prints. Without this, a POS sale reserves stock
// forever — stocked_quantity keeps counting items that left the shop, so a
// stocktake disagrees with the system and the shortfall grows with every
// sale. auto-pull-inventory reads (stocked − reserved) < 0 as a signal to
// move stock between warehouses, so phantom reservations eventually make it
// transfer goods to cover sales that already happened.
//
// ── Constraints this has to respect ─────────────────────────────────────
// • Medusa refuses a fulfillment that mixes items requiring shipping with
//   items that do not, so each group gets its own fulfillment.
// • createOrderFulfillmentWorkflow reads the order's shipping option
//   unconditionally to find the provider and profile. An order with no
//   shipping method at all cannot go through it, so we say so rather than
//   letting it fail on a null dereference.
// • location_id is taken from the reservation, which is where the stock was
//   actually held. The workflow would otherwise fall back to the location
//   linked to the shipping option, which for a walk-in sale is the wrong
//   warehouse or missing entirely.

export type FulfillResult = {
  fulfilled: boolean
  /** Why nothing happened, when nothing happened. */
  reason?: string
  fulfillment_ids: string[]
  /** Line items covered, for the caller's log or receipt. */
  items: { id: string; quantity: number }[]
}

type Outstanding = {
  id: string
  quantity: number
  requires_shipping: boolean
}

const num = (v: unknown): number => {
  if (typeof v === "number") return v
  if (typeof v === "string") return Number(v) || 0
  if (v && typeof v === "object" && "value" in (v as any)) {
    return Number((v as any).value) || 0
  }
  return 0
}

/**
 * Create fulfillments covering everything on the order not yet fulfilled.
 *
 * Idempotent: quantities already fulfilled are subtracted, so calling it
 * twice on the same order does nothing the second time. That matters — the
 * till retries, and a double call must not decrement stock twice.
 *
 * Throws on a genuine failure. Callers that have already taken money should
 * catch: see the note in the POS record-payment route.
 */
export const fulfillOrderNow = async (
  container: MedusaContainer,
  orderId: string,
  options: { createdBy?: string } = {}
): Promise<FulfillResult> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "items.requires_shipping",
      "items.detail.quantity",
      "items.detail.fulfilled_quantity",
      "shipping_methods.shipping_option_id",
    ],
    filters: { id: orderId },
  })

  const order = (orders as any[])[0]
  if (!order) {
    return { fulfilled: false, reason: "order not found", fulfillment_ids: [], items: [] }
  }

  const outstanding: Outstanding[] = (order.items ?? [])
    .map((item: any) => ({
      id: item.id,
      quantity: num(item.detail?.quantity) - num(item.detail?.fulfilled_quantity),
      requires_shipping: item.requires_shipping !== false,
    }))
    .filter((i: Outstanding) => i.quantity > 0)

  if (!outstanding.length) {
    return {
      fulfilled: false,
      reason: "everything on this order is already fulfilled",
      fulfillment_ids: [],
      items: [],
    }
  }

  if (!order.shipping_methods?.length) {
    return {
      fulfilled: false,
      reason:
        "order has no shipping method, so Medusa cannot resolve a fulfillment provider",
      fulfillment_ids: [],
      items: [],
    }
  }

  // Where the stock is actually held. Reservations are per line item, and a
  // POS sale is one location, so the first one answers for the order.
  const { data: reservations } = await query.graph({
    entity: "reservation",
    fields: ["id", "line_item_id", "location_id"],
    filters: { line_item_id: outstanding.map((i) => i.id) },
  })
  const locationId = (reservations as any[])[0]?.location_id ?? undefined

  // Shipping and non-shipping items cannot share a fulfillment.
  const groups = [
    outstanding.filter((i) => i.requires_shipping),
    outstanding.filter((i) => !i.requires_shipping),
  ].filter((g) => g.length)

  const fulfillmentIds: string[] = []
  for (const group of groups) {
    const { result } = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: orderId,
        created_by: options.createdBy,
        location_id: locationId,
        // The customer is standing there holding it; an email saying it
        // has been fulfilled is noise.
        no_notification: true,
        items: group.map((i) => ({ id: i.id, quantity: i.quantity })),
      },
    })
    if ((result as any)?.id) {
      fulfillmentIds.push((result as any).id)
    }
  }

  return {
    fulfilled: true,
    fulfillment_ids: fulfillmentIds,
    items: outstanding.map((i) => ({ id: i.id, quantity: i.quantity })),
  }
}
