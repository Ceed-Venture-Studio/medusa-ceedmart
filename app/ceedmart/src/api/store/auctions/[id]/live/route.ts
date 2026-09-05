import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../modules/auction"
import { minimumNextBid } from "../../../../../lib/auction/rules"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// The poll target for a live auction (BRD §8.6, D-14).
//
// D-14 chose short polling over real-time infrastructure. §8.6 requires the
// interface update "the current bid, minimum next bid, bid count, leader
// state, and remaining time promptly" — all of which this returns from a
// single row read, which is why the auction table carries denormalised
// counters rather than aggregating the bid ledger on every request from
// every viewer.
//
// `no-store` is essential: a cached auction price is a wrong auction price,
// and the whole design assumes the server is authoritative (§8.6).

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(req.params.id).catch(() => null)

  if (!auction || auction.status === "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "This auction was not found."
    )
  }

  const now = new Date()
  const endsAt = new Date(auction.ends_at)
  const auth = (req as any).auth_context
  const viewerId = auth?.actor_type === "customer" ? auth.actor_id : null

  res.setHeader("Cache-Control", "no-store")

  res.json({
    id: auction.id,
    status: auction.status,
    current_price:
      auction.current_price === null ? null : Number(auction.current_price),
    starting_price: Number(auction.starting_price),
    min_next_bid: minimumNextBid({
      starting_price: Number(auction.starting_price),
      min_increment: Number(auction.min_increment),
      current_price:
        auction.current_price === null ? null : Number(auction.current_price),
    }),
    min_increment: Number(auction.min_increment),
    buy_now_price:
      auction.buy_now_price === null ? null : Number(auction.buy_now_price),
    currency_code: auction.currency_code,
    bid_count: auction.bid_count,

    // §8.4 — reserve is hidden; only whether it is met is exposed.
    has_reserve: auction.reserve_price !== null,
    reserve_met:
      auction.reserve_price === null
        ? true
        : Number(auction.current_price ?? 0) >= Number(auction.reserve_price),

    ends_at: auction.ends_at,
    // Server-computed, so a bidder with a skewed clock still sees the truth.
    seconds_remaining: Math.max(
      0,
      Math.floor((endsAt.getTime() - now.getTime()) / 1000)
    ),
    server_time: now.toISOString(),
    // §8.7 — the extended end time is broadcast to all viewers.
    extension_count: auction.extension_count,

    // Leader state for THIS viewer only. Revealing who leads would defeat
    // the masking §8.6 requires.
    viewer_is_leading: !!viewerId && auction.leading_bidder_id === viewerId,
  })
}
