import { getOrdersListWorkflow } from "@medusajs/core-flows"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  POS_ORDER_LIST_FIELDS,
  inIdOrder,
  listPosOrderIds,
  toPosOrderRow,
} from "../../../lib/pos/orders-list"
import { PosListOrders } from "./validators"

// A page of orders for the till's order table, filtered and paged in SQL so
// the till downloads one small page instead of hundreds of full orders.
// See lib/pos/orders-list.ts for why /admin/orders doesn't fit.

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const parsed = PosListOrders.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const { limit, offset, ...filters } = parsed.data
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const { ids, count } = await listPosOrderIds(knex, filters, { limit, offset })

  let orders: ReturnType<typeof toPosOrderRow>[] = []
  if (ids.length) {
    const { result } = await getOrdersListWorkflow(req.scope).run({
      input: {
        fields: POS_ORDER_LIST_FIELDS,
        variables: { filters: { id: ids }, take: ids.length, skip: 0 },
      },
    })
    const rows = ((result as { rows?: unknown[] }).rows ?? result) as Parameters<
      typeof toPosOrderRow
    >[0][]
    orders = inIdOrder(ids, rows.map(toPosOrderRow))
  }

  res.json({ orders, count, limit, offset })
}
