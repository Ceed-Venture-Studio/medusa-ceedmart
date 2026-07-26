import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../modules/partner"

type PatchBody = {
  name?: string
  email?: string | null
  phone?: string | null
  company?: string | null
  commission_rate?: number | null
  status?: "active" | "inactive" | "suspended"
  notes?: string | null
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(PARTNER_MODULE)
  const partner = await svc.retrievePartner(id).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${id} not found`)
  }
  res.json({ partner })
}

export const PATCH = async (req: AuthenticatedMedusaRequest<PatchBody>, res: MedusaResponse) => {
  const { id } = req.params
  const body = req.body || ({} as PatchBody)

  const update: Record<string, any> = { id }
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.email !== undefined) update.email = body.email?.trim() || null
  if (body.phone !== undefined) update.phone = body.phone?.trim() || null
  if (body.company !== undefined) update.company = body.company?.trim() || null
  if (body.commission_rate !== undefined) {
    update.commission_rate =
      body.commission_rate === null
        ? 0.07
        : Math.max(0, Math.min(1, Number(body.commission_rate) || 0))
  }
  if (body.status !== undefined) update.status = body.status
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const svc: any = req.scope.resolve(PARTNER_MODULE)
  const updated = await svc.updatePartners(update)
  res.json({ partner: Array.isArray(updated) ? updated[0] : updated })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(PARTNER_MODULE)
  await svc.deletePartners(id)
  res.json({ id, object: "partner", deleted: true })
}
