import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveShopper } from "../../../../lib/assistant/shopper"
import { chatCartFor } from "../../../../lib/smartai/cart"

// GET /store/assistant/cart → { cart_id, checkout_url, item_count }
//
// The cart the assistant has built for this shopper, for the app's
// "Checkout" button (integration guide §9): open checkout_url to pay on the
// website, or — once the app has its own checkout — load cart_id. Nulls when
// the shopper has no chat cart yet.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const shopper = await resolveShopper(req)
  if (!shopper) {
    return res.status(403).json({
      error: {
        code: "shopper_required",
        message: "Sign in, or get a guest pass from POST /store/assistant/guest.",
      },
    })
  }
  res.json(await chatCartFor(req.scope, shopper.id))
}
