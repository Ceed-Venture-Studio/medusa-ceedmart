import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOLAR_MODULE } from "../../../../modules/solar"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const q = (req.query.q as string | undefined)?.trim()
  const status = req.query.status as string | undefined
  const tier = req.query.selected_tier as string | undefined
  const from = req.query.from as string | undefined
  const to = req.query.to as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (status) filters.status = status
  if (tier) filters.selected_tier = tier
  if (q) {
    filters.$or = [
      { customer_name: { $ilike: `%${q}%` } },
      { customer_email: { $ilike: `%${q}%` } },
      { customer_phone: { $ilike: `%${q}%` } },
    ]
  }
  if (from || to) {
    filters.created_at = {}
    if (from) filters.created_at.$gte = new Date(from)
    if (to) filters.created_at.$lte = new Date(to)
  }

  const svc: any = req.scope.resolve(SOLAR_MODULE)
  const [quotes, count] = await svc.listAndCountSolarQuotes(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  res.json({ quotes, count, limit, offset })
}
