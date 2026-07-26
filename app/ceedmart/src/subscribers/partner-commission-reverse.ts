import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { reverseForOrder } from "../lib/partner-commissions"

export default async function partnerCommissionReverseHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const orderId = event.data?.id
  if (!orderId) return
  await reverseForOrder(container, orderId, event.name)
}

export const config: SubscriberConfig = {
  event: ["order.canceled"],
  context: { subscriberId: "ceedmart-partner-commission-reverse" },
}
