import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { timingSafeEqual } from "node:crypto"

// /smartai/* is called only by Ceedmart's shopping MCP, with
// Authorization: Bearer <SMARTAI_BACKEND_SECRET>. It creates and changes
// carts, so it is neither public (publishable key) nor an admin session.
// With no secret configured the routes are off.

const MIN_SECRET = 32

export const requireSmartaiSecret = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const secret = process.env.SMARTAI_BACKEND_SECRET ?? ""
  if (secret.length < MIN_SECRET) {
    return res.status(503).json({ message: "SmartAI shopping is not configured" })
  }
  const presented = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""))
  const expected = Buffer.from(secret)
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return res.status(401).json({ message: "Unauthorized" })
  }
  return next()
}
