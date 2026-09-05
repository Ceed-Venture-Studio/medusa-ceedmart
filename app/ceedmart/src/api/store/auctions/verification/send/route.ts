import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { sendPhoneOtp } from "../../../../../lib/auction/eligibility"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Send a phone verification code to a prospective bidder (BRD §5.2).

type Body = { phone: string }

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

  const result = await sendPhoneOtp(req.scope, {
    customerId,
    phone: req.body?.phone ?? "",
    email: auth?.app_metadata?.email ?? null,
  })

  res.json(result)
}
