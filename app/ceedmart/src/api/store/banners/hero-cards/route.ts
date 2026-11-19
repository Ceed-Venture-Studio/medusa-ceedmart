import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { heroCardsFromMetadata } from "../../../../lib/banner/hero-cards"

// GET /store/banners/hero-cards — the cards under the home hero. Always
// answers with a list: the saved one, or the built-in defaults.
// Storefront caches with the 'banners' tag.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "store", fields: ["id", "metadata"] })
  const { cards } = heroCardsFromMetadata((data as any[])[0]?.metadata)
  res.json({ cards })
}
