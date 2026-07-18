import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Lightweight list of stock locations for the shop drawer's sourcing
// priority picker. Kept under /admin/shops/* so a future permission scope
// can gate it alongside the shop routes.

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
    pagination: { skip: 0, take: 200 },
  })
  const rows = (locations as any[])
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  res.json({ stock_locations: rows })
}
