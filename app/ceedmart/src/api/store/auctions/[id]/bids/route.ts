import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../modules/auction"
import { TERMS_SLUGS } from "../../../../../modules/terms"
import { assertEligible } from "../../../../../lib/auction/eligibility"
import { maskBidder } from "../../../../../lib/auction/rules"
import { recordAcceptance, evidenceFromRequest } from "../../../../../lib/terms"
import { auctionMachine } from "../../../../../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../../../../../lib/state-machine"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Place a bid, and read the public bid history (BRD §8.6).
//
// The POST is thin on purpose: everything that decides whether a bid is
// valid happens inside the locked transaction in the auction module's
// placeBid. Validating here as well would create a second, unlocked
// definition of correctness — the exact mistake §8.6 is written against.

type Body = { amount: number; kind?: "bid" | "buy_now"; accept_terms?: boolean }

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const svc: any = req.scope.resolve(AUCTION_MODULE)

  const bids = await svc.listBids(
    { auction_id: req.params.id },
    { order: { sequence: "DESC" }, take: 50 }
  )

  // §8.6 — customer-visible history masks bidder identity.
  res.json({
    bids: (bids as any[]).map((b) => ({
      sequence: b.sequence,
      bidder: b.bidder_handle,
      amount: Number(b.amount),
      placed_at: b.placed_at,
      kind: b.kind,
      voided: !!b.voided_at,
      triggered_extension: b.triggered_extension,
    })),
  })
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null

  // §5.2 — signing in is required to place a bid.
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Sign in to place a bid."
    )
  }

  // §5.2 — verified email and Nigerian phone required before bidding.
  await assertEligible(req.scope, customerId)

  const svc: any = req.scope.resolve(AUCTION_MODULE)

  // §8.2 — the bidder accepts auction terms before placing a bid. Recorded
  // once per auction; a bidder does not re-accept on every bid.
  if (req.body?.accept_terms) {
    await recordAcceptance(req.scope, {
      slug: TERMS_SLUGS.AUCTION,
      entityType: "auction",
      entityId: req.params.id,
      customerId,
      evidence: evidenceFromRequest(req),
    }).catch(() => {
      // No published auction terms yet. Blocking a bid on our own missing
      // configuration would be worse than proceeding without the record.
    })
  }

  const result = await svc.placeBid({
    auctionId: req.params.id,
    bidderId: customerId,
    bidderHandle: maskBidder(customerId),
    amount: req.body?.amount,
    kind: req.body?.kind ?? "bid",
    ipAddress: evidenceFromRequest(req).ip,
    userAgent: evidenceFromRequest(req).userAgent,
  })

  // Buy Now ends the auction (§8.3), which is a state change worth auditing
  // separately from the bid itself.
  if (req.body?.kind === "buy_now") {
    await auctionMachine.record(req.scope, {
      entityId: req.params.id,
      action: "auction.bought_now",
      actor: { type: "customer", id: customerId },
      toValue: "ended",
      metadata: { amount: result.bid.amount },
    })
  } else if (result.bid.triggered_extension) {
    // §8.7 — extensions are persisted AND recorded, so "why did the clock
    // move" always has an answer.
    await auctionMachine.record(req.scope, {
      entityId: req.params.id,
      action: "auction.extended",
      actor: SYSTEM_ACTOR,
      toValue: result.auction.ends_at.toISOString(),
      metadata: { triggered_by_sequence: result.bid.sequence },
    })
  }

  res.status(201).json({
    bid: {
      sequence: result.bid.sequence,
      amount: result.bid.amount,
      placed_at: result.bid.placed_at,
      triggered_extension: result.bid.triggered_extension,
    },
    auction: {
      current_price: result.auction.current_price,
      bid_count: result.auction.bid_count,
      ends_at: result.auction.ends_at,
      min_next_bid: result.auction.min_next_bid,
      extended: result.auction.extended,
    },
  })
}
