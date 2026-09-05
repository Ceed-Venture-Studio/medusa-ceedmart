import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { BUILD_MODULE } from "../../../../modules/build"

// Build-request queue for specialists (BRD §13).
//
// Sorted so requests waiting on US come before those waiting on the
// customer — the queue exists to show what needs work, and a request we
// have already answered is not work.

const WAITING_ON_US = ["submitted", "under_review", "revision_requested"]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_MODULE)

  const filters: Record<string, unknown> = {}
  if (typeof req.query.status === "string" && req.query.status) {
    filters.status = req.query.status.split(",")
  }

  const requests = await svc.listBuildRequests(filters, {
    order: { created_at: "DESC" },
    take: Number(req.query.limit) || 50,
  })

  // Attach the current quote so the queue can show what was last sent
  // without a request per row.
  const ids = (requests as any[]).map((r) => r.id)
  const quotes = ids.length
    ? await svc.listBuildQuotes({ request_id: ids }, { take: 200 })
    : []
  const quoteByRequest = new Map<string, any>(
    (quotes as any[]).map((q) => [q.request_id, q])
  )

  const rows = (requests as any[]).map((r) => ({
    ...r,
    quote: quoteByRequest.get(r.id) ?? null,
    waiting_on_us: WAITING_ON_US.includes(r.status),
  }))

  rows.sort((a, b) => Number(b.waiting_on_us) - Number(a.waiting_on_us))

  res.json({ requests: rows })
}
