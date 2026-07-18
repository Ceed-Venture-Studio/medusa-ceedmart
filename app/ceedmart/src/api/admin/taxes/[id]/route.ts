import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CEEDMART_TAX_MODULE } from "../../../../modules/ceedmart-tax"

type PatchBody = {
  name?: string
  rate?: number
  is_tax_inclusive?: boolean
  scope?: "general" | "collection" | "shop"
  reference_id?: string | null
  is_active?: boolean
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(CEEDMART_TAX_MODULE)
  const row = await svc.retrieveTaxOverride(id).catch(() => null)
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Tax override ${id} not found`
    )
  }
  res.json({ tax_override: row })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<PatchBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as PatchBody)

  const update: Record<string, any> = { id }
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.rate !== undefined) {
    if (typeof body.rate !== "number" || body.rate < 0 || body.rate > 100) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "rate must be a number between 0 and 100"
      )
    }
    update.rate = body.rate
  }
  if (body.is_tax_inclusive !== undefined) {
    update.is_tax_inclusive = !!body.is_tax_inclusive
  }
  if (body.scope !== undefined) update.scope = body.scope
  if (body.reference_id !== undefined) {
    update.reference_id = body.reference_id?.trim() || null
  }
  if (body.is_active !== undefined) update.is_active = !!body.is_active

  const svc: any = req.scope.resolve(CEEDMART_TAX_MODULE)
  const updated = await svc.updateTaxOverrides(update)
  res.json({
    tax_override: Array.isArray(updated) ? updated[0] : updated,
  })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(CEEDMART_TAX_MODULE)
  const row = await svc.retrieveTaxOverride(id).catch(() => null)
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Tax override ${id} not found`
    )
  }
  await svc.deleteTaxOverrides(id)
  res.json({ id, object: "tax_override", deleted: true })
}
