import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STOCK_TRANSFER_MODULE } from "../../../modules/stock-transfer"

// GET /admin/stock-transfers
// Optional filters: order_id, from_location_id, to_location_id, q (matches
// product_title or variant_sku, ILIKE), limit/offset for pagination.
// Sorted newest first.

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const orderId = req.query.order_id as string | undefined
  const from = req.query.from_location_id as string | undefined
  const to = req.query.to_location_id as string | undefined
  const q = (req.query.q as string | undefined)?.trim()
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (orderId) filters.order_id = orderId
  if (from) filters.from_location_id = from
  if (to) filters.to_location_id = to
  if (q) {
    filters.$or = [
      { product_title: { $ilike: `%${q}%` } },
      { variant_sku: { $ilike: `%${q}%` } },
    ]
  }

  const svc: any = req.scope.resolve(STOCK_TRANSFER_MODULE)
  const [transfers, count] = await svc.listAndCountStockTransfers(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({ transfers, count, limit, offset })
}
