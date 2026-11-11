import { z } from "@medusajs/framework/zod"
import { FULFILLMENT_STATUSES } from "../../../lib/pos/orders-list"

export const PosListOrders = z.object({
  q: z.string().max(100).optional(),
  sales_channel_id: z.string().max(100).optional(),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type PosListOrdersType = z.infer<typeof PosListOrders>
