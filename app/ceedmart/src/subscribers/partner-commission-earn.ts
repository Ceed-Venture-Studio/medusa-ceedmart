import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { markCompletedForOrder } from "../lib/partner-commissions"

export default async function partnerCommissionEarnHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const orderId = event.data?.id
  if (!orderId) return
  await markCompletedForOrder(container, orderId, event.name)
}

// Medusa fires order.updated + order.fulfillment_created + order.completed
// through the order flow. We listen on the terminal "completed" event —
// the spec's verified state requires payment + delivery, which is what
// completion implies.
export const config: SubscriberConfig = {
  event: ["order.completed"],
  context: { subscriberId: "ceedmart-partner-commission-earn" },
}
