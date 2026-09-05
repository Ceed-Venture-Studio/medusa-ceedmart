import {
  InjectManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"
import { applyAntiSnipe, assertBiddable, checkBid } from "../../lib/auction/rules"
import Auction from "./models/auction"
import Bid from "./models/bid"
import BidderEligibility from "./models/bidder-eligibility"
import AuctionResult from "./models/auction-result"
import WinnerOffer from "./models/winner-offer"
import BidderDeposit from "./models/bidder-deposit"
import AuctionDispute from "./models/auction-dispute"

export type PlaceBidInput = {
  auctionId: string
  bidderId: string
  bidderHandle: string
  amount: number
  kind?: "bid" | "buy_now"
  ipAddress?: string | null
  userAgent?: string | null
}

export type PlaceBidResult = {
  bid: {
    id: string
    sequence: number
    amount: number
    placed_at: Date
    triggered_extension: boolean
  }
  auction: {
    current_price: number
    bid_count: number
    ends_at: Date
    min_next_bid: number
    extended: boolean
  }
}

export default class AuctionModuleService extends MedusaService({
  Auction,
  Bid,
  BidderEligibility,
  AuctionResult,
  WinnerOffer,
  BidderDeposit,
  AuctionDispute,
}) {
  /**
   * Accept a bid, atomically (BRD §8.6, §8.7, §8.8).
   *
   * ── Why this is one SQL transaction ─────────────────────────────────
   * §8.6: "bid acceptance must be atomic and safe under simultaneous
   * requests" and "two concurrent bids cannot both be accepted as the same
   * leading sequence."
   *
   * Application-level checking cannot provide that. Two Cloud Run instances
   * both read a current price of ₦100,000, both decide ₦110,000 is valid,
   * and both write. The guarantee has to come from the database:
   *
   *   1. SELECT ... FOR UPDATE on the auction row. The second transaction
   *      BLOCKS here until the first commits, so it validates against the
   *      first bid's price rather than a stale one.
   *   2. Sequence is assigned from the locked row, and the unique index on
   *      (auction_id, sequence) is a second line of defence — if the lock
   *      were ever bypassed, Postgres still refuses the duplicate.
   *   3. Anti-snipe extension is computed and persisted inside the same
   *      transaction, so an extension can never be lost to a crash between
   *      accepting the bid and moving the clock.
   *
   * Everything is validated against values read INSIDE the lock. Nothing
   * the caller passed about the auction's state is trusted.
   */
  @InjectManager()
  async placeBid(
    input: PlaceBidInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<PlaceBidResult> {
    const manager: any = (sharedContext as any).manager

    return await manager.transactional(async (tx: any) => {
      const now = new Date()

      // ── 1. Lock the auction row ──────────────────────────────────
      const rows = await tx.execute(
        `select "id", "status", "starts_at", "ends_at", "starting_price",
                "min_increment", "buy_now_price", "current_price",
                "bid_count", "last_sequence", "leading_bidder_id",
                "antisnipe_window_seconds", "antisnipe_extension_seconds",
                "extension_count", "max_bids_per_bidder", "currency_code"
           from "auction"
          where "id" = ? and "deleted_at" is null
          for update`,
        [input.auctionId]
      )

      const auction = Array.isArray(rows) ? rows[0] : rows
      if (!auction) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "This auction was not found."
        )
      }

      // ── 2. Validate against locked state ─────────────────────────
      // The RULES live in lib/auction/rules as pure functions, and are
      // applied here to values read inside the lock. Restating them in SQL
      // would give us two definitions of a bid's validity that could drift
      // apart; the transaction's job is the concurrency guarantee, not the
      // arithmetic.
      const check = checkBid(
        {
          status: auction.status,
          starts_at: auction.starts_at,
          ends_at: auction.ends_at,
          starting_price: Number(auction.starting_price),
          min_increment: Number(auction.min_increment),
          current_price:
            auction.current_price === null ? null : Number(auction.current_price),
          buy_now_price:
            auction.buy_now_price === null ? null : Number(auction.buy_now_price),
          leading_bidder_id: auction.leading_bidder_id,
          antisnipe_window_seconds: Number(auction.antisnipe_window_seconds ?? 0),
          antisnipe_extension_seconds: Number(
            auction.antisnipe_extension_seconds ?? 0
          ),
        },
        { amount: input.amount, bidderId: input.bidderId, kind: input.kind },
        now
      )

      // Throws the framework error the API layer renders directly.
      assertBiddable(check)

      const amount = Math.round(Number(input.amount))
      const increment = Number(auction.min_increment)
      const isBuyNow = input.kind === "buy_now"

      // Per-bidder cap. Not in the pure rules because it needs a count the
      // caller cannot be trusted to supply.
      if (auction.max_bids_per_bidder) {
        const countRows = await tx.execute(
          `select count(*)::int as count from "bid"
            where "auction_id" = ? and "bidder_id" = ? and "voided_at" is null`,
          [input.auctionId, input.bidderId]
        )
        const placed = Number(
          (Array.isArray(countRows) ? countRows[0] : countRows)?.count ?? 0
        )
        if (placed >= Number(auction.max_bids_per_bidder)) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "You've reached the bid limit for this auction."
          )
        }
      }

      // ── 3. Anti-sniping (§8.7) ───────────────────────────────────
      // Computed and persisted inside THIS transaction, so a crash between
      // accepting the bid and moving the clock cannot lose the extension.
      const snipe = applyAntiSnipe(
        {
          ends_at: auction.ends_at,
          antisnipe_window_seconds: Number(auction.antisnipe_window_seconds ?? 0),
          antisnipe_extension_seconds: Number(
            auction.antisnipe_extension_seconds ?? 0
          ),
        },
        now,
        isBuyNow ? "buy_now" : "bid"
      )
      const extended = snipe.extended
      const nextEndsAt = snipe.ends_at

      // ── 4. Write the bid ─────────────────────────────────────────
      const sequence = Number(auction.last_sequence ?? 0) + 1
      const bidId = `bid_${input.auctionId.slice(-8)}_${sequence}_${Math.random()
        .toString(36)
        .slice(2, 8)}`

      await tx.execute(
        `insert into "bid"
           ("id", "auction_id", "sequence", "bidder_id", "bidder_handle",
            "amount", "currency_code", "placed_at", "kind",
            "triggered_extension", "ip_address", "user_agent",
            "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [
          bidId,
          input.auctionId,
          sequence,
          input.bidderId,
          input.bidderHandle,
          amount,
          auction.currency_code ?? "ngn",
          now,
          isBuyNow ? "buy_now" : "bid",
          extended,
          input.ipAddress ?? null,
          input.userAgent ?? null,
        ]
      )

      // ── 5. Advance the auction ───────────────────────────────────
      // Buy Now ends it immediately (§8.3).
      await tx.execute(
        `update "auction"
            set "current_price" = ?,
                "bid_count" = "bid_count" + 1,
                "leading_bidder_id" = ?,
                "leading_bid_id" = ?,
                "last_sequence" = ?,
                "ends_at" = ?,
                "extension_count" = "extension_count" + ?,
                "status" = ?,
                "updated_at" = now()
          where "id" = ?`,
        [
          amount,
          input.bidderId,
          bidId,
          sequence,
          isBuyNow ? now : nextEndsAt,
          extended ? 1 : 0,
          isBuyNow ? "ended" : "live",
          input.auctionId,
        ]
      )

      return {
        bid: {
          id: bidId,
          sequence,
          amount,
          placed_at: now,
          triggered_extension: extended,
        },
        auction: {
          current_price: amount,
          bid_count: Number(auction.bid_count ?? 0) + 1,
          ends_at: isBuyNow ? now : nextEndsAt,
          min_next_bid: amount + increment,
          extended,
        },
      }
    })
  }

  /**
   * Close an auction exactly once (BRD §8.8).
   *
   * "Auction closing must be idempotent and safe if the closing job
   * retries." Two guarantees make it so:
   *
   *   • the auction row is locked, so two closing jobs serialise;
   *   • auction_result has a unique index on auction_id, so even if both
   *     got through, the second insert fails rather than creating a second
   *     outcome.
   *
   * Returns the existing result when the auction was already closed, so a
   * retry is quiet rather than an error.
   */
  @InjectManager()
  async closeAuction(
    auctionId: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ alreadyClosed: boolean; result: any }> {
    const manager: any = (sharedContext as any).manager

    return await manager.transactional(async (tx: any) => {
      const now = new Date()

      const rows = await tx.execute(
        `select "id", "status", "ends_at", "reserve_price", "bid_count",
                "leading_bid_id", "leading_bidder_id", "current_price",
                "currency_code", "terms_version_id"
           from "auction"
          where "id" = ? and "deleted_at" is null
          for update`,
        [auctionId]
      )
      const auction = Array.isArray(rows) ? rows[0] : rows
      if (!auction) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Auction ${auctionId} was not found`
        )
      }

      const existingRows = await tx.execute(
        `select * from "auction_result" where "auction_id" = ? and "deleted_at" is null`,
        [auctionId]
      )
      const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows
      if (existing) {
        return { alreadyClosed: true, result: existing }
      }

      // Only a live or just-ended auction closes. A cancelled one does not.
      if (auction.status !== "live" && auction.status !== "ended") {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Auction ${auctionId} is ${auction.status} and cannot be closed`
        )
      }

      // §8.8 — the highest valid bid wins IF the reserve is met. Otherwise
      // there is no winner, rather than the highest bidder by default.
      const reserve =
        auction.reserve_price === null ? null : Number(auction.reserve_price)
      const currentPrice =
        auction.current_price === null ? null : Number(auction.current_price)

      const reserveMet =
        currentPrice !== null && (reserve === null || currentPrice >= reserve)

      // Ties resolve on the earliest accepted server timestamp, then the
      // lowest sequence — both are recorded inside the bid transaction, so
      // this is deterministic. Voided bids are excluded.
      const winningRows = reserveMet
        ? await tx.execute(
            `select "id", "bidder_id", "amount"
               from "bid"
              where "auction_id" = ? and "voided_at" is null
              order by "amount" desc, "placed_at" asc, "sequence" asc
              limit 1`,
            [auctionId]
          )
        : []
      const winning = Array.isArray(winningRows) ? winningRows[0] : winningRows

      const uniqueRows = await tx.execute(
        `select count(distinct "bidder_id")::int as count from "bid"
          where "auction_id" = ? and "voided_at" is null`,
        [auctionId]
      )
      const uniqueBidders = Number(
        (Array.isArray(uniqueRows) ? uniqueRows[0] : uniqueRows)?.count ?? 0
      )

      const resultId = `aures_${auctionId.slice(-10)}`

      await tx.execute(
        `insert into "auction_result"
           ("id", "auction_id", "winning_bid_id", "winner_id", "winning_amount",
            "currency_code", "closed_at", "reserve_met", "reserve_price",
            "bid_count", "unique_bidders", "terms_version_id",
            "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
         on conflict ("auction_id") do nothing`,
        [
          resultId,
          auctionId,
          winning?.id ?? null,
          winning?.bidder_id ?? null,
          winning ? Number(winning.amount) : null,
          auction.currency_code ?? "ngn",
          now,
          reserveMet && !!winning,
          reserve,
          Number(auction.bid_count ?? 0),
          uniqueBidders,
          auction.terms_version_id ?? null,
        ]
      )

      await tx.execute(
        `update "auction" set "status" = ?, "updated_at" = now() where "id" = ?`,
        [winning ? "awaiting_winner_payment" : "reserve_not_met", auctionId]
      )

      const savedRows = await tx.execute(
        `select * from "auction_result" where "auction_id" = ?`,
        [auctionId]
      )

      return {
        alreadyClosed: false,
        result: Array.isArray(savedRows) ? savedRows[0] : savedRows,
      }
    })
  }
}
