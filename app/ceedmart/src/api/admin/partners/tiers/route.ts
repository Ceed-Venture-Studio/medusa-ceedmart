import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_TIERS, DEFAULT_TIER } from "../../../../lib/partner-commissions/tiers"

// GET /admin/partners/tiers — enumerates the incentive-spec tiers +
// their default commission rates. Admin drawer uses this to populate the
// tier dropdown so the UI is a projection of the same source of truth.

export const GET = async (_req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.json({
    tiers: PARTNER_TIERS,
    default: DEFAULT_TIER,
  })
}
