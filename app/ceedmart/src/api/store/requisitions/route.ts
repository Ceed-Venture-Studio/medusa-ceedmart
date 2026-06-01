import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CAREERS_MODULE } from "../../../modules/careers"

// Public list of open job postings — consumed by the storefront careers page.
// No auth required; returns only requisitions with status="open".

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100)

  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const [requisitions, count] = await svc.listAndCountRequisitions(
    { status: "open" },
    { take: limit, skip: 0, order: { created_at: "DESC" } }
  )

  res.json({ requisitions, count })
}
