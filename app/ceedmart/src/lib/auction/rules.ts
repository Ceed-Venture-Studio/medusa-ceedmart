import { MedusaError } from "@medusajs/framework/utils"

// Pure auction rules (BRD §8.6, §8.7, §8.8).
//
// The authoritative implementation lives inside the locked transaction in
// modules/auction/service.ts, because correctness under concurrency needs
// the database. This module holds the same ARITHMETIC as pure functions so
// it can be tested exhaustively without a Postgres instance, and so the
// storefront can compute the same minimum without a round trip.
//
// Keep the two in step: if a rule changes here it changes there.

export type AuctionState = {
  status: string
  starts_at: Date | string
  ends_at: Date | string
  starting_price: number
  min_increment: number
  current_price: number | null
  buy_now_price: number | null
  leading_bidder_id: string | null
  antisnipe_window_seconds: number
  antisnipe_extension_seconds: number
}

const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)

/**
 * The lowest amount that would be accepted right now.
 *
 * The first bid may equal the starting price; every later bid must clear the
 * current price by at least one increment. §8.11 requires a rejected bid
 * tell the bidder this number.
 */
export const minimumNextBid = (auction: {
  starting_price: number
  min_increment: number
  current_price: number | null
}): number => {
  const current = auction.current_price
  if (current === null || current === undefined) {
    return Math.round(auction.starting_price)
  }
  return Math.round(current + auction.min_increment)
}

export type BidRejection =
  | "not_live"
  | "not_started"
  | "ended"
  | "below_minimum"
  | "self_outbid"
  | "invalid_amount"
  | "no_buy_now"
  | "wrong_buy_now_amount"

export type BidCheck =
  | { ok: true; minimum: number }
  | { ok: false; reason: BidRejection; message: string; minimum: number }

/**
 * Whether a bid would be accepted.
 *
 * Mirrors the checks inside the locked transaction. Used by the storefront
 * for immediate feedback and by tests; never as the authority, because
 * between this check and the write another bidder may have moved the price.
 */
export const checkBid = (
  auction: AuctionState,
  args: { amount: number; bidderId: string; kind?: "bid" | "buy_now" },
  now: Date = new Date()
): BidCheck => {
  const minimum = minimumNextBid(auction)
  const reject = (reason: BidRejection, message: string): BidCheck => ({
    ok: false,
    reason,
    message,
    minimum,
  })

  if (auction.status !== "live") {
    return auction.status === "scheduled"
      ? reject("not_started", "This auction hasn't started yet.")
      : reject("not_live", "This auction has closed.")
  }

  if (now < asDate(auction.starts_at)) {
    return reject("not_started", "This auction hasn't started yet.")
  }

  // §8.8 — server time is authoritative.
  if (now >= asDate(auction.ends_at)) {
    return reject("ended", "This auction has ended.")
  }

  const amount = Math.round(Number(args.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return reject("invalid_amount", "That bid amount isn't valid.")
  }

  if (args.kind === "buy_now") {
    if (auction.buy_now_price === null || auction.buy_now_price === undefined) {
      return reject("no_buy_now", "This auction doesn't have a Buy Now price.")
    }
    if (amount !== Math.round(auction.buy_now_price)) {
      return reject(
        "wrong_buy_now_amount",
        "Buy Now must be for the exact Buy Now price."
      )
    }
    return { ok: true, minimum }
  }

  if (amount < minimum) {
    return reject(
      "below_minimum",
      `Your bid is below the minimum. The next bid must be at least ${minimum}.`
    )
  }

  // §8.6 — no bidding against yourself to raise your own leading price.
  // Proxy bidding is out of scope for MVP (D-09), so there is no legitimate
  // case for it.
  if (auction.leading_bidder_id === args.bidderId) {
    return reject("self_outbid", "You're already the highest bidder.")
  }

  return { ok: true, minimum }
}

/**
 * Whether a bid at `now` extends the auction, and the new end time (§8.7).
 *
 * "If a valid bid is placed during the configured closing window, the end
 * time extends by the configured duration."
 *
 * The extension is measured from NOW, not from the old end — a bid with two
 * seconds left buys the full window, which is what stops sniping. Buy Now
 * ends the auction rather than extending it.
 */
export const applyAntiSnipe = (
  auction: {
    ends_at: Date | string
    antisnipe_window_seconds: number
    antisnipe_extension_seconds: number
  },
  now: Date = new Date(),
  kind: "bid" | "buy_now" = "bid"
): { extended: boolean; ends_at: Date } => {
  const endsAt = asDate(auction.ends_at)

  if (kind === "buy_now") return { extended: false, ends_at: endsAt }

  const windowMs = Number(auction.antisnipe_window_seconds ?? 0) * 1000
  const extensionMs = Number(auction.antisnipe_extension_seconds ?? 0) * 1000

  if (windowMs <= 0 || extensionMs <= 0) {
    return { extended: false, ends_at: endsAt }
  }

  const remaining = endsAt.getTime() - now.getTime()
  if (remaining > windowMs) return { extended: false, ends_at: endsAt }

  return { extended: true, ends_at: new Date(now.getTime() + extensionMs) }
}

export type BidRow = {
  id: string
  bidder_id: string
  amount: number
  placed_at: Date | string
  sequence: number
  voided_at?: Date | string | null
}

/**
 * Pick the winner (BRD §8.8).
 *
 * Highest valid bid wins IF the reserve is met. Ties resolve on the earliest
 * accepted server timestamp, then the lowest sequence — both recorded inside
 * the bid transaction, so the outcome is deterministic and reproducible.
 *
 * Voided bids are excluded, but the sequence they consumed stays consumed:
 * §8.6 forbids rewriting the ledger to read as though a bid never happened.
 */
export const determineWinner = (
  bids: BidRow[],
  reservePrice: number | null
): { winner: BidRow | null; reserveMet: boolean; highest: BidRow | null } => {
  const valid = bids.filter((b) => !b.voided_at)

  if (!valid.length) {
    return { winner: null, reserveMet: false, highest: null }
  }

  const sorted = [...valid].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount
    const at = asDate(a.placed_at).getTime()
    const bt = asDate(b.placed_at).getTime()
    if (at !== bt) return at - bt
    return a.sequence - b.sequence
  })

  const highest = sorted[0]
  const reserveMet = reservePrice === null || highest.amount >= reservePrice

  return { winner: reserveMet ? highest : null, reserveMet, highest }
}

/**
 * The bidders to fall back on if the winner defaults (§8.9), best first.
 *
 * One entry per bidder at their highest valid bid — offering someone their
 * own earlier, lower bid would be a worse deal than they already made.
 */
export const rankedFallbackBidders = (
  bids: BidRow[],
  excludeBidderIds: string[] = [],
  reservePrice: number | null = null
): BidRow[] => {
  const excluded = new Set(excludeBidderIds)
  const best = new Map<string, BidRow>()

  for (const bid of bids) {
    if (bid.voided_at) continue
    if (excluded.has(bid.bidder_id)) continue
    if (reservePrice !== null && bid.amount < reservePrice) continue

    const current = best.get(bid.bidder_id)
    if (!current || bid.amount > current.amount) best.set(bid.bidder_id, bid)
  }

  return [...best.values()].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount
    return asDate(a.placed_at).getTime() - asDate(b.placed_at).getTime()
  })
}

/**
 * Mask a bidder for public history (§8.6).
 *
 * "Customer-visible bid history should mask bidder identity, for example
 * `Bidder ••••4821`." Derived from the id so the same bidder reads
 * consistently down the whole history, and stable across page loads.
 */
export const maskBidder = (bidderId: string): string => {
  const digits = bidderId.replace(/\D/g, "")
  const tail = digits.length >= 4
    ? digits.slice(-4)
    : // No digits in the id — derive four stable ones rather than
      // exposing any part of the raw identifier.
      String(
        Math.abs(
          [...bidderId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
        ) % 10000
      ).padStart(4, "0")

  return `Bidder ••••${tail}`
}

/** Reject a bid with the framework error the API layer renders directly. */
export const assertBiddable = (check: BidCheck): void => {
  if (check.ok) return
  const type =
    check.reason === "below_minimum" ||
    check.reason === "invalid_amount" ||
    check.reason === "wrong_buy_now_amount"
      ? MedusaError.Types.INVALID_DATA
      : MedusaError.Types.NOT_ALLOWED
  throw new MedusaError(type, check.message)
}
