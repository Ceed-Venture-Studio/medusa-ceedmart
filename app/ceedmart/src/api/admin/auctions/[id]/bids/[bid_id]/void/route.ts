import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../../../modules/auction"
import { actorFromRequest } from "../../../../../../../lib/state-machine"
import { auctionMachine } from "../../../../../../../lib/state-machine/machines"
import { determineWinner } from "../../../../../../../lib/auction/rules"

// Void an invalid bid (BRD §8.6).
//
// "Administrators cannot edit or delete accepted bids. Invalid bids can only
// be voided through a recorded, permission-controlled process that PRESERVES
// THE AUDIT TRAIL."
//
// So: no delete, no amount edit. The row stays, the sequence it consumed
// stays consumed, and a reason is mandatory. Voiding is visible in the
// public history too — a bid that disappeared silently would make the
// ledger look tampered with, which is worse than showing it was withdrawn.

type Body = { reason: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id, bid_id } = req.params
  const reason = (req.body?.reason || "").trim()

  if (!reason) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Voiding a bid requires a reason — it stays on the permanent record."
    )
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const actor = actorFromRequest(req)

  const bid = await svc.retrieveBid(bid_id).catch(() => null)
  if (!bid || bid.auction_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Bid ${bid_id} was not found on this auction`
    )
  }

  if (bid.voided_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This bid has already been voided."
    )
  }

  const auction = await svc.retrieveAuction(id).catch(() => null)
  if (!auction) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Auction ${id} was not found`)
  }

  // A closed auction's result is a snapshot (§8.8). Voiding a bid after the
  // fact must not silently re-decide who won — that needs a dispute and a
  // deliberate re-close, not a side effect of this endpoint.
  const [result] = await svc.listAuctionResults({ auction_id: id }, { take: 1 })
  if (result) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This auction has already closed. Raise a dispute to reopen the outcome rather than voiding a bid after the fact."
    )
  }

  await svc.updateBids({
    id: bid_id,
    voided_at: new Date(),
    voided_by: actor.id ?? actor.label ?? null,
    void_reason: reason,
  })

  await auctionMachine.record(req.scope, {
    entityId: id,
    action: "bid.voided",
    actor,
    reason,
    correlationId: id,
    metadata: {
      bid_id,
      sequence: bid.sequence,
      amount: Number(bid.amount),
      bidder_id: bid.bidder_id,
    },
  })

  // Recompute the leader from the remaining valid bids. The voided bid may
  // have been the leading one, and leaving it as leader would let a voided
  // bid win.
  const remaining = await svc.listBids({ auction_id: id }, { take: 500 })
  const valid = (remaining as any[]).map((b) => ({
    id: b.id,
    bidder_id: b.bidder_id,
    amount: Number(b.amount),
    placed_at: b.placed_at,
    sequence: b.sequence,
    voided_at: b.id === bid_id ? new Date() : b.voided_at,
  }))

  const { highest } = determineWinner(valid, null)

  await svc.updateAuctions({
    id,
    current_price: highest ? highest.amount : null,
    leading_bidder_id: highest?.bidder_id ?? null,
    leading_bid_id: highest?.id ?? null,
    // bid_count counts valid bids, so it drops with the void. last_sequence
    // deliberately does NOT — the sequence stays consumed.
    bid_count: valid.filter((b) => !b.voided_at).length,
  })

  res.json({
    bid: { id: bid_id, voided: true, reason },
    auction: {
      current_price: highest ? highest.amount : null,
      leading_bidder_id: highest?.bidder_id ?? null,
    },
  })
}
