import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SEARCH_LOG_MODULE } from "../../../modules/search-log"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const q = (req.query.q as string | undefined)?.trim()
  const customerId = req.query.customer_id as string | undefined
  const sessionId = req.query.session_id as string | undefined
  const salesChannelId = req.query.sales_channel_id as string | undefined
  const from = req.query.from as string | undefined
  const to = req.query.to as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 500)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (q) filters.query = { $ilike: `%${q}%` }
  if (customerId) filters.customer_id = customerId
  if (sessionId) filters.session_id = sessionId
  if (salesChannelId) filters.sales_channel_id = salesChannelId
  if (from || to) {
    filters.created_at = {}
    if (from) filters.created_at.$gte = new Date(from)
    if (to) filters.created_at.$lte = new Date(to)
  }

  const svc: any = req.scope.resolve(SEARCH_LOG_MODULE)
  const [search_logs, count] = await svc.listAndCountSearchLogs(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  res.json({ search_logs, count, limit, offset })
}
