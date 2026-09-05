import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  checkEligibility,
  verifyPhoneOtp,
} from "../../../../../lib/auction/eligibility"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Confirm a phone verification code (BRD §5.2).

type Body = { code: string }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Sign in to verify your phone number."
    )
  }

  const result = await verifyPhoneOtp(req.scope, {
    customerId,
    code: req.body?.code ?? "",
  })

  const eligibility = await checkEligibility(req.scope, customerId)

  res.json({ ...result, eligibility })
}
