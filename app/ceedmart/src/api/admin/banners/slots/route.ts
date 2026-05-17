import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BANNER_SLOTS } from "../../../../lib/banner/slots"

// Surface the slot catalog to the admin UI so the form can render dropdowns
// + dimension hints without hard-coding them on the frontend.
export const GET = async (_req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.json({ slots: BANNER_SLOTS })
}
