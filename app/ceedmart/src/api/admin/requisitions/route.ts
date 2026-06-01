import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CAREERS_MODULE } from "../../../modules/careers"

type CreateBody = {
  title: string
  description: string
  apply_url: string
  salary?: string | null
  status?: "open" | "closed"
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const status = req.query.status as string | undefined
  const q = (req.query.q as string | undefined)?.trim()
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (status) filters.status = status
  if (q) filters.title = { $ilike: `%${q}%` }

  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const [requisitions, count] = await svc.listAndCountRequisitions(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({ requisitions, count, limit, offset })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateBody>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as CreateBody)
  if (!body.title?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "title is required")
  }
  if (!body.description?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "description is required"
    )
  }
  if (!body.apply_url?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "apply_url is required"
    )
  }

  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const requisition = await svc.createRequisitions({
    title: body.title.trim(),
    description: body.description,
    apply_url: body.apply_url.trim(),
    salary: body.salary?.trim() || null,
    status: body.status ?? "open",
  })
  res.status(201).json({ requisition })
}
