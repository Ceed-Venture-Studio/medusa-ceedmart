import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Cheap ping used by the offline POS connection monitor to confirm the
// backend is actually reachable (vs the device having wifi but no internet,
// captive portal, backend down, etc.). Returns server time so the client
// can detect clock skew if needed.
//
// Auth-gated under /pos/* like everything else in this directory — a 401
// still counts as "reachable" on the client side.

export const GET = async (_req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.json({
    ok: true,
    server_time: new Date().toISOString(),
    supported_schema_version: 1,
  })
}
