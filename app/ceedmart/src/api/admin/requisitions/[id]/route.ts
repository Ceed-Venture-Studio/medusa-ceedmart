import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CAREERS_MODULE } from "../../../../modules/careers"

type PatchBody = {
  title?: string
  description?: string
  apply_url?: string
  salary?: string | null
  status?: "open" | "closed"
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const requisition = await svc.retrieveRequisition(id).catch(() => null)
  if (!requisition) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Requisition ${id} not found`
    )
  }
  res.json({ requisition })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<PatchBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as PatchBody)

  const update: Record<string, any> = { id }
  if (body.title !== undefined) update.title = body.title.trim()
  if (body.description !== undefined) update.description = body.description
  if (body.apply_url !== undefined) update.apply_url = body.apply_url.trim()
  if (body.salary !== undefined) {
    update.salary = body.salary?.trim() || null
  }
  if (body.status !== undefined) update.status = body.status

  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const updated = await svc.updateRequisitions(update)
  res.json({ requisition: Array.isArray(updated) ? updated[0] : updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const requisition = await svc.retrieveRequisition(id).catch(() => null)
  if (!requisition) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Requisition ${id} not found`
    )
  }
  await svc.deleteRequisitions(id)
  res.json({ id, object: "requisition", deleted: true })
}
