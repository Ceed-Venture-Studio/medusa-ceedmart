import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SEARCH_LOG_MODULE } from "../../../../modules/search-log"

const DAY_MS = 24 * 60 * 60 * 1000

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const days = Math.max(
    1,
    Math.min(Number(req.query.days ?? 7), 365)
  )
  const since = new Date(Date.now() - days * DAY_MS)

  const svc: any = req.scope.resolve(SEARCH_LOG_MODULE)
  const logs: any[] = await svc.listSearchLogs(
    { created_at: { $gte: since } },
    {
      take: 50_000,
      order: { created_at: "DESC" },
    }
  )

  const total = logs.length
  const zero = logs.filter((l) => (l.result_count ?? 0) === 0).length

  const countByQuery = new Map<string, number>()
  const countByZeroQuery = new Map<string, number>()
  for (const l of logs) {
    const q = (l.query || "").toLowerCase().trim()
    if (!q) continue
    countByQuery.set(q, (countByQuery.get(q) ?? 0) + 1)
    if ((l.result_count ?? 0) === 0) {
      countByZeroQuery.set(q, (countByZeroQuery.get(q) ?? 0) + 1)
    }
  }

  const toSorted = (m: Map<string, number>, n = 10) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([query, count]) => ({ query, count }))

  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const daily = new Map<string, { total: number; zero: number }>()
  for (let i = days - 1; i >= 0; i--) {
    daily.set(dayKey(new Date(Date.now() - i * DAY_MS)), { total: 0, zero: 0 })
  }
  for (const l of logs) {
    const k = dayKey(new Date(l.created_at))
    const slot = daily.get(k)
    if (!slot) continue
    slot.total += 1
    if ((l.result_count ?? 0) === 0) slot.zero += 1
  }

  res.json({
    window_days: days,
    since: since.toISOString(),
    total_searches: total,
    unique_queries: countByQuery.size,
    zero_result_count: zero,
    zero_result_rate: total === 0 ? 0 : zero / total,
    top_queries: toSorted(countByQuery),
    top_zero_queries: toSorted(countByZeroQuery),
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
  })
}
