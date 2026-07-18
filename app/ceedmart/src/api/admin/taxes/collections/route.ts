import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Helper endpoint powering the collection picker in the tax admin drawer.
// Returns product collections with id + title/handle, sorted for display.

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle"],
    pagination: { skip: 0, take: 500 },
  })
  const rows = (collections as any[])
    .map((c) => ({ id: c.id, title: c.title, handle: c.handle }))
    .sort((a, b) => a.title.localeCompare(b.title))
  res.json({ collections: rows })
}
