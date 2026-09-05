import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { PREORDER_MODULE } from "../../../modules/preorder"
import { isOverdue, accumulatedPausedDays } from "../../../lib/preorder/estimate"
import { PREORDER_CUSTOMER_STAGE } from "../../../lib/state-machine/machines"

// The pre-order ops queue (BRD §6.5 exception queue, §13 reporting).
//
// Ops needs three questions answered at a glance: what is late, what is
// stuck in an exception, and what is waiting on a customer. Rather than
// making the admin UI compute that from raw statuses, each row carries the
// derived flags — so "overdue" means the same thing on the dashboard, in a
// CSV export, and in an alert.

const EXCEPTION_STATUSES = [
  "delivery_exception",
  "unable_to_source",
  "refund_pending",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const now = new Date()

  const filters: Record<string, unknown> = {}

  if (typeof req.query.status === "string" && req.query.status) {
    filters.status = req.query.status.split(",")
  }
  if (typeof req.query.order_id === "string") {
    filters.order_id = req.query.order_id
  }
  // Convenience filter for the queue the exception workflow depends on.
  if (req.query.view === "exceptions") {
    filters.status = EXCEPTION_STATUSES
  }

  const rows = await svc.listPreorderOrders(filters, {
    order: { created_at: "DESC" },
    take: Number(req.query.limit) || 50,
    skip: Number(req.query.offset) || 0,
  })

  const preorders = (rows as any[]).map((row) => {
    const promised = row.promised_delivery_date
      ? new Date(row.promised_delivery_date)
      : null

    return {
      ...row,
      // Simplified stage the customer sees, so admin and customer are
      // never describing the same order differently.
      customer_stage: PREORDER_CUSTOMER_STAGE[row.status] ?? row.status,
      is_exception: EXCEPTION_STATUSES.includes(row.status),
      is_overdue: isOverdue(promised, now),
      is_paused: !!row.paused_at,
      paused_days: accumulatedPausedDays(
        row.paused_days ?? 0,
        row.paused_at ? new Date(row.paused_at) : null,
        now
      ),
    }
  })

  // Overdue and exception rows first — the queue exists to surface what
  // needs a human, not to list everything in date order.
  preorders.sort((a, b) => {
    const rank = (r: any) => (r.is_exception ? 0 : r.is_overdue ? 1 : 2)
    return rank(a) - rank(b)
  })

  res.json({ preorders, count: preorders.length })
}
