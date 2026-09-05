import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../modules/preorder"

// Source suppliers for US pre-orders (BRD §6.4).
//
// Kept as records rather than free text so procurement can see which
// supplier's items actually arrive inside the promised window — the number
// that decides whether the delivery estimate is honest.

type Body = {
  name: string
  country_code?: string
  reference?: string
  contact_email?: string
  contact_phone?: string
  notes?: string
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const suppliers = await svc.listSourceSuppliers(
    typeof req.query.is_active === "string"
      ? { is_active: req.query.is_active === "true" }
      : {},
    { order: { name: "ASC" }, take: 200 }
  )
  res.json({ suppliers })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as Body)

  if (!body.name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required")
  }

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const supplier = await svc.createSourceSuppliers({
    name: body.name.trim(),
    country_code: (body.country_code ?? "us").toLowerCase(),
    reference: body.reference?.trim() || null,
    contact_email: body.contact_email?.trim()?.toLowerCase() || null,
    contact_phone: body.contact_phone?.trim() || null,
    notes: body.notes?.trim() || null,
    is_active: true,
  })

  res.status(201).json({ supplier })
}
