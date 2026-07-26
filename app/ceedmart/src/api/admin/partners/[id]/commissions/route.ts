import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMISSION_ENTRY_MODULE } from "../../../../../modules/commission-entry"

// GET /admin/partners/:id/commissions
// Returns a page of commission_entries for the partner + inline totals so
// the admin doesn't need a second query for the header numbers.
// Filters:
//   status  — pending | earned | reversed
//   from    — ISO date lower bound (created_at)
//   to      — ISO date upper bound (created_at)

const asNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return v
  if (typeof v === "string") return parseFloat(v) || 0
  if (v && typeof v === "object" && "value" in (v as any)) {
    return Number((v as any).value) || 0
  }
  return 0
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const status = req.query.status as string | undefined
  const from = req.query.from as string | undefined
  const to = req.query.to as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = { partner_id: id }
  if (status) filters.status = status
  if (from || to) {
    filters.created_at = {}
    if (from) filters.created_at.$gte = new Date(from)
    if (to) filters.created_at.$lte = new Date(to)
  }

  const svc: any = req.scope.resolve(COMMISSION_ENTRY_MODULE)
  const [entries, count] = await svc.listAndCountCommissionEntries(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  // Totals ignore pagination — compute from a separate un-paged read of
  // the same filter set. We only fetch the fields we need for summing.
  const allForSum = await svc.listCommissionEntries(filters, {
    take: 5000,
    fields: ["status", "commission_amount", "eligible_amount"],
  })
  const totals = {
    pending_amount: 0,
    earned_amount: 0,
    reversed_amount: 0,
    net_amount: 0,
    eligible_amount: 0,
  }
  for (const row of allForSum as any[]) {
    const amt = asNumber(row.commission_amount)
    const elig = asNumber(row.eligible_amount)
    if (row.status === "pending") totals.pending_amount += amt
    else if (row.status === "earned") totals.earned_amount += amt
    else if (row.status === "reversed") totals.reversed_amount += amt
    totals.net_amount += amt
    totals.eligible_amount += elig
  }

  res.json({ entries, count, limit, offset, totals })
}
