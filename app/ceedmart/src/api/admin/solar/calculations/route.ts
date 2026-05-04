import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOLAR_MODULE } from "../../../../modules/solar"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const sessionId = req.query.session_id as string | undefined
  const heavy = req.query.has_heavy_motors as string | undefined
  const from = req.query.from as string | undefined
  const to = req.query.to as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (sessionId) filters.session_id = sessionId
  if (heavy === "true") filters.has_heavy_motors = true
  if (heavy === "false") filters.has_heavy_motors = false
  if (from || to) {
    filters.created_at = {}
    if (from) filters.created_at.$gte = new Date(from)
    if (to) filters.created_at.$lte = new Date(to)
  }

  const svc: any = req.scope.resolve(SOLAR_MODULE)
  const [calculations, count] = await svc.listAndCountSolarCalculations(
    filters,
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  )

  res.json({ calculations, count, limit, offset })
}
