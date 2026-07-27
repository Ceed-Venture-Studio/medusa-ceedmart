import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../modules/partner"
import {
  DEFAULT_TIER,
  isValidTier,
  rateForTier,
  PartnerTierCode,
} from "../../../lib/partner-commissions/tiers"

// Excludes visually ambiguous chars (0/O, 1/I/L) for hand-typed use.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function randomCode(len = 8): string {
  let out = ""
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

async function nextUniqueCode(svc: any, tries = 8): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const code = randomCode()
    const existing = await svc.listPartners({ code }, { take: 1 })
    if (!existing.length) return code
  }
  throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to allocate a unique partner code")
}

type CreateBody = {
  name: string
  email?: string | null
  phone?: string | null
  company?: string | null
  code?: string | null            // optional — otherwise auto-generated
  tier?: PartnerTierCode          // SHOPPER (default) / EMPLOYEE_SALES / RESELLER / PARTNER
  status?: "active" | "inactive" | "suspended"
  notes?: string | null
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const status = req.query.status as string | undefined
  const q = (req.query.q as string | undefined)?.trim()
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (status) filters.status = status
  if (q) {
    filters.$or = [
      { name: { $ilike: `%${q}%` } },
      { code: { $ilike: `%${q}%` } },
      { email: { $ilike: `%${q}%` } },
      { company: { $ilike: `%${q}%` } },
    ]
  }

  const svc: any = req.scope.resolve(PARTNER_MODULE)
  const [partners, count] = await svc.listAndCountPartners(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({ partners, count, limit, offset })
}

export const POST = async (req: AuthenticatedMedusaRequest<CreateBody>, res: MedusaResponse) => {
  const body = req.body || ({} as CreateBody)
  if (!body.name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required")
  }
  const svc: any = req.scope.resolve(PARTNER_MODULE)

  let code = body.code?.trim().toUpperCase()
  if (code) {
    const clash = await svc.listPartners({ code }, { take: 1 })
    if (clash.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Code "${code}" is already in use`)
    }
  } else {
    code = await nextUniqueCode(svc)
  }

  const tier: PartnerTierCode =
    body.tier && isValidTier(body.tier) ? body.tier : DEFAULT_TIER
  const rate = rateForTier(tier)

  const partner = await svc.createPartners({
    name: body.name.trim(),
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    company: body.company?.trim() || null,
    code,
    tier,
    commission_rate: rate,
    status: body.status ?? "active",
    notes: body.notes?.trim() || null,
  })
  res.status(201).json({ partner })
}
