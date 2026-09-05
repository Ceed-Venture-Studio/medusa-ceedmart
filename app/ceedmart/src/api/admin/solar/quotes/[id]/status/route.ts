import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOLAR_MODULE } from "../../../../../../modules/solar"
import { actorFromRequest } from "../../../../../../lib/state-machine"
import { solarQuoteMachine } from "../../../../../../lib/state-machine/machines"

// P0-2 — retrofitted onto the shared transition framework.
//
// This route previously checked the target status against a flat `ALLOWED`
// Set, which accepted any known status from any other: a quote already
// marked `won` could be flipped back to `new`, and nothing recorded who did
// it. It now validates the move against the sales funnel and writes an
// audit row for every accepted change.

type Body = { status: string; reason?: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const status = (req.body?.status || "").trim()

  const svc: any = req.scope.resolve(SOLAR_MODULE)

  const existing = await svc.retrieveSolarQuote(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Solar quote with id: ${id} was not found`
    )
  }

  // Throws a MedusaError the framework renders directly if the move is
  // illegal, so nothing is written on a rejected transition.
  await solarQuoteMachine.transition(req.scope, {
    entityId: id,
    from: existing.status,
    to: status,
    actor: actorFromRequest(req),
    reason: req.body?.reason,
  })

  const updated = await svc.updateSolarQuotes({ id, status })
  res.json({ quote: Array.isArray(updated) ? updated[0] : updated })
}
