import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOLAR_MODULE } from "../../../../modules/solar"

const DAY_MS = 24 * 60 * 60 * 1000

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const days = Math.max(1, Math.min(Number(req.query.days ?? 30), 365))
  const since = new Date(Date.now() - days * DAY_MS)

  const svc: any = req.scope.resolve(SOLAR_MODULE)

  const [quotes, calcs] = await Promise.all([
    svc.listSolarQuotes(
      { created_at: { $gte: since } },
      { take: 50_000, order: { created_at: "DESC" } }
    ),
    svc.listSolarCalculations(
      { created_at: { $gte: since } },
      { take: 50_000, order: { created_at: "DESC" } }
    ),
  ])

  const byStatus: Record<string, number> = {
    new: 0, contacted: 0, quoted: 0, won: 0, lost: 0,
  }
  const byTier: Record<string, number> = { budget: 0, recommended: 0, premium: 0 }
  let totalValue = 0
  let valueCount = 0
  let wonValue = 0
  let wonCount = 0
  let currency: string | null = null

  for (const q of quotes as any[]) {
    if (byStatus[q.status] !== undefined) byStatus[q.status] += 1
    if (byTier[q.selected_tier] !== undefined) byTier[q.selected_tier] += 1
    const price = q.selected_bundle?.total_price
    const ccy = q.selected_bundle?.currency_code
    if (typeof price === "number") {
      totalValue += price
      valueCount += 1
      if (q.status === "won") {
        wonValue += price
        wonCount += 1
      }
      if (!currency && ccy) currency = ccy
    }
  }

  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const daily = new Map<string, { calcs: number; quotes: number }>()
  for (let i = days - 1; i >= 0; i--) {
    daily.set(dayKey(new Date(Date.now() - i * DAY_MS)), { calcs: 0, quotes: 0 })
  }
  for (const c of calcs as any[]) {
    const slot = daily.get(dayKey(new Date(c.created_at)))
    if (slot) slot.calcs += 1
  }
  for (const q of quotes as any[]) {
    const slot = daily.get(dayKey(new Date(q.created_at)))
    if (slot) slot.quotes += 1
  }

  res.json({
    window_days: days,
    since: since.toISOString(),
    total_calculations: calcs.length,
    total_quotes: quotes.length,
    conversion_rate: calcs.length === 0 ? 0 : quotes.length / calcs.length,
    by_status: byStatus,
    by_tier: byTier,
    avg_quote_value: valueCount === 0 ? null : Math.round(totalValue / valueCount),
    won_value: wonCount === 0 ? null : wonValue,
    won_count: wonCount,
    currency_code: currency,
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
  })
}
