import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CEEDMART_TAX_MODULE } from "../../../modules/ceedmart-tax"

// Admin CRUD for Ceedmart tax overrides. The rules feed the custom tax
// provider that Medusa's tax module calls during cart/order totals.

type ScopeKind = "general" | "collection" | "shop"

type CreateBody = {
  name: string
  rate: number
  is_tax_inclusive?: boolean
  scope: ScopeKind
  reference_id?: string | null
  is_active?: boolean
}

const VALID_SCOPES: ScopeKind[] = ["general", "collection", "shop"]

const validateBody = (body: CreateBody) => {
  if (!body.name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required")
  }
  if (typeof body.rate !== "number" || !Number.isFinite(body.rate)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "rate must be a number")
  }
  if (body.rate < 0 || body.rate > 100) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "rate must be between 0 and 100")
  }
  if (!VALID_SCOPES.includes(body.scope)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `scope must be one of ${VALID_SCOPES.join(", ")}`
    )
  }
  if (body.scope !== "general" && !body.reference_id?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `reference_id is required for scope=${body.scope}`
    )
  }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(CEEDMART_TAX_MODULE)
  const [rows, count] = await svc.listAndCountTaxOverrides(
    {},
    { take: 500, order: { scope: "ASC", name: "ASC" } }
  )
  res.json({ tax_overrides: rows, count })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateBody>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as CreateBody)
  validateBody(body)

  const svc: any = req.scope.resolve(CEEDMART_TAX_MODULE)
  const created = await svc.createTaxOverrides({
    name: body.name.trim(),
    rate: body.rate,
    is_tax_inclusive: !!body.is_tax_inclusive,
    scope: body.scope,
    reference_id:
      body.scope === "general" ? null : (body.reference_id?.trim() || null),
    is_active: body.is_active !== false,
  })
  res.status(201).json({ tax_override: created })
}
