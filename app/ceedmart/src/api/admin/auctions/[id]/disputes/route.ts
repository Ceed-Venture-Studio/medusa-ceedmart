import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../modules/auction"
import { actorFromRequest } from "../../../../../lib/state-machine"
import { auctionMachine } from "../../../../../lib/state-machine/machines"

// Auction disputes (BRD §8.10).
//
// "A support workflow must capture payment, condition, bid-validity, and
// fulfilment disputes."

const KINDS = new Set(["payment", "condition", "bid_validity", "fulfilment", "other"])

type Body = {
  kind: string
  description: string
  raised_by?: string
  evidence?: Record<string, unknown>
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const disputes = await svc.listAuctionDisputes(
    { auction_id: req.params.id },
    { order: { created_at: "DESC" }, take: 50 }
  )
  res.json({ disputes })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as Body)

  if (!KINDS.has(body.kind)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `kind must be one of ${[...KINDS].join(", ")}`
    )
  }
  if (!body.description?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "description is required"
    )
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(req.params.id).catch(() => null)
  if (!auction) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Auction ${req.params.id} was not found`
    )
  }

  const dispute = await svc.createAuctionDisputes({
    auction_id: req.params.id,
    raised_by: body.raised_by ?? null,
    kind: body.kind,
    description: body.description.trim(),
    evidence: body.evidence ?? null,
    status: "open",
  })

  // Move the auction into `disputed` where the machine allows it, so a
  // disputed sale stops progressing through fulfilment unnoticed.
  if (auctionMachine.canTransition(auction.status, "disputed")) {
    await auctionMachine.transition(req.scope, {
      entityId: req.params.id,
      from: auction.status,
      to: "disputed",
      actor: actorFromRequest(req),
      reason: `${body.kind}: ${body.description.trim().slice(0, 140)}`,
      correlationId: req.params.id,
    })
    await svc.updateAuctions({ id: req.params.id, status: "disputed" })
  }

  res.status(201).json({ dispute })
}
