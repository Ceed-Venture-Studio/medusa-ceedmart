import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../../modules/auction"
import { actorFromRequest } from "../../../../../../lib/state-machine"
import { auctionMachine } from "../../../../../../lib/state-machine/machines"

// Work a dispute to a conclusion (BRD §8.10).
//
// Raising one is handled by the collection route; this moves it along and
// closes it. A resolution is mandatory on close: "resolved" with no
// account of what was decided is not a resolution, and §8.10's whole point
// is that disputes leave a record.

type Body = {
  status: "investigating" | "resolved" | "rejected"
  resolution?: string
  /** Where to send the auction once the dispute is settled. */
  auction_status?: string
}

const STATUSES = new Set(["investigating", "resolved", "rejected"])

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id, dispute_id } = req.params
  const body = req.body || ({} as Body)
  const actor = actorFromRequest(req)

  if (!STATUSES.has(body.status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `status must be one of ${[...STATUSES].join(", ")}`
    )
  }

  const closing = body.status === "resolved" || body.status === "rejected"
  if (closing && !body.resolution?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Closing a dispute requires a note saying what was decided."
    )
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const dispute = await svc.retrieveAuctionDispute(dispute_id).catch(() => null)
  if (!dispute || dispute.auction_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Dispute ${dispute_id} was not found on this auction`
    )
  }

  const now = new Date()
  const updated = await svc.updateAuctionDisputes({
    id: dispute_id,
    status: body.status,
    resolution: body.resolution?.trim() || null,
    resolved_at: closing ? now : null,
    resolved_by: closing ? (actor.label ?? actor.id ?? null) : null,
  })

  await auctionMachine.record(req.scope, {
    entityId: id,
    action: `dispute.${body.status}`,
    actor,
    fromValue: dispute.status,
    toValue: body.status,
    reason: body.resolution ?? null,
    correlationId: id,
    metadata: { dispute_id, kind: dispute.kind },
  })

  // A settled dispute usually needs the auction moved on — back into
  // fulfilment, or into a refund. Optional, and validated by the machine.
  if (closing && body.auction_status) {
    const auction = await svc.retrieveAuction(id).catch(() => null)
    const target = body.auction_status
    // isKnown narrows an arbitrary string to a state the machine declares,
    // so a typo in the request body is rejected rather than compared.
    if (
      auction &&
      auctionMachine.isKnown(target) &&
      auctionMachine.canTransition(auction.status, target)
    ) {
      await auctionMachine.transition(req.scope, {
        entityId: id,
        from: auction.status,
        to: target,
        actor,
        reason: `Dispute ${body.status}: ${body.resolution?.trim() ?? ""}`.trim(),
        correlationId: id,
      })
      await svc.updateAuctions({ id, status: target })
    }
  }

  res.json({ dispute: Array.isArray(updated) ? updated[0] : updated })
}
