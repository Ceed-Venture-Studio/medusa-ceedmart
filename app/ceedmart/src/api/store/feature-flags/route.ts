import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { allFlags } from "../../../lib/feature-flags"

// Publishes feature-flag state to the storefront and POS.
//
// The POS matters most here: it is an installed Tauri app on cashier
// hardware, so it cannot be redeployed to turn a feature off. It reads this
// at boot and on reconnect, which makes a single backend env var the kill
// switch for every till in the field.
//
// Deliberately unauthenticated — flag names carry no secrets, and the POS
// needs them before it has a session.

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  // Short cache: long enough to absorb a fleet of tills polling on
  // reconnect, short enough that switching a feature off reaches them in
  // under a minute.
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
  res.json({ flags: allFlags() })
}
