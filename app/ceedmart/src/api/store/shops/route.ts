import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Public list of active Ceedmart shops for the storefront's pickup
// selector. Returns display-ready fields only — no publishable API key or
// stock location internals.

type PublicShop = {
  id: string
  name: string
  code: string
  city: string | null
  address: string | null
  phone: string | null
}

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const query = _req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled", "metadata"],
    pagination: { skip: 0, take: 200 },
  })
  const shops: PublicShop[] = (channels as any[])
    .filter((c) => !c.is_disabled)
    .filter((c) => (c.metadata as any)?.ceedmart?.code)
    .map((c) => {
      const md = (c.metadata as any).ceedmart ?? {}
      return {
        id: c.id,
        name: c.name,
        code: String(md.code ?? ""),
        city: md.city ?? null,
        address: md.address ?? null,
        phone: md.phone ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  res.json({ shops })
}
