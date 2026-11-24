import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { verifyGuestToken } from "./guest-token"

// Who is chatting — always decided by the server, never taken from the app
// (integration guide §3, §5):
//   signed-in customer → their Medusa customer id (cus_…)
//   guest              → the id inside a guest token we signed (gst_…)
// SmartAI passes this id to our shopping MCP unchanged (after trimming), so
// it is also the key of the shopper's chat cart in smartai_shopper_cart.

export const GUEST_HEADER = "x-assistant-guest"

export const assistantConfig = () => ({
  smartaiUrl: (process.env.SMARTAI_BASE_URL || "https://smartai-image-lab-api-dmqvu6cisq-ew.a.run.app").replace(/\/$/, ""),
  commerceKey: process.env.SMARTAI_COMMERCE_KEY ?? "",
  guestSecret: process.env.ASSISTANT_GUEST_SECRET ?? "",
})

export type Shopper = { id: string; firstName: string | null; kind: "customer" | "guest" }

export const resolveShopper = async (req: MedusaRequest): Promise<Shopper | null> => {
  const auth = (req as any).auth_context
  if (auth?.actor_type === "customer" && auth.actor_id) {
    let firstName: string | null = null
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "customer",
        fields: ["id", "first_name"],
        filters: { id: auth.actor_id },
      })
      firstName = ((data as any[])[0]?.first_name ?? "").trim().slice(0, 60) || null
    } catch {
      // A greeting without a name is fine.
    }
    return { id: auth.actor_id, firstName, kind: "customer" }
  }

  const { guestSecret } = assistantConfig()
  if (guestSecret.length < 32) return null
  const guestId = verifyGuestToken(req.headers[GUEST_HEADER], guestSecret)
  return guestId ? { id: guestId, firstName: null, kind: "guest" } : null
}
