import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { issueGuestToken } from "../../../../lib/assistant/guest-token"
import { assistantConfig } from "../../../../lib/assistant/shopper"

// POST /store/assistant/guest → { guest_id, guest_token }
//
// One guest identity per app install, for shoppers who chat without signing
// in. The app stores guest_token and sends it as the `x-assistant-guest`
// header on /store/assistant/*. Nothing is stored here: the token's
// signature is the proof (lib/assistant/guest-token).

export const POST = async (_req: MedusaRequest, res: MedusaResponse) => {
  const { guestSecret } = assistantConfig()
  if (guestSecret.length < 32) {
    return res.status(503).json({
      error: { code: "assistant_unavailable", message: "The shopping assistant is not set up." },
    })
  }
  res.json(issueGuestToken(guestSecret))
}
