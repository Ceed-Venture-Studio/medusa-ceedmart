import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { countUnfulfilledOrders } from "../../../../lib/pos/orders-list"

// The till's sidebar badge: how many orders are waiting to be fulfilled.
// One number, instead of the till downloading every order to count them.

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  res.json({ unfulfilled_count: await countUnfulfilledOrders(knex) })
}
