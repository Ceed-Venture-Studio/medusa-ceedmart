import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { accrueForOrderPlaced } from "../lib/partner-commissions"

export default async function partnerCommissionAccrueHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const orderId = event.data?.id
  if (!orderId) return
  await accrueForOrderPlaced(container, orderId)
}

export const config: SubscriberConfig = {
  event: ["order.placed"],
  context: { subscriberId: "ceedmart-partner-commission-accrue" },
}
