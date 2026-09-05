import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../modules/auction"
import { auctionMachine } from "../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../lib/state-machine"
import { runOnce } from "../lib/jobs/idempotency"
import { sendNotification } from "../lib/notifications/send"
import { createWinnerOffer, releaseLosingDeposits } from "../lib/auction/settle"

// P4-6 — close auctions whose end time has passed (BRD §8.8).
//
// ── Why the safety here is layered ──────────────────────────────────────
// §8.8 requires closing be "idempotent and safe if the closing job retries",
// and §12.2 that it "recover safely from restarts and duplicate execution".
// Three independent mechanisms, because an auction closing twice means two
// people are told they won:
//
//   1. runOnce claims each auction, so concurrent instances split the batch;
//   2. closeAuction locks the auction row, so two closers serialise;
//   3. auction_result has a unique index on auction_id, so even if both
//      previous layers failed, the second insert is refused.
//
// Layer 3 is the one that actually guarantees it. The first two exist to
// make the guarantee cheap rather than to provide it.
//
// Runs every minute, and re-checks the end time INSIDE the claim: an
// anti-snipe extension may have moved ends_at between the query and the
// close, and closing an auction someone is still bidding in would be the
// worst possible bug here.

const BATCH_LIMIT = 200

export default async function closeAuctionsJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(AUCTION_MODULE)
  const now = new Date()

  let due: any[] = []
  try {
    due = await svc.listAuctions(
      { status: ["live", "ended"], ends_at: { $lte: now } },
      { take: BATCH_LIMIT, order: { ends_at: "ASC" } }
    )
  } catch (err: any) {
    logger.error(`[close-auctions] query failed: ${err?.message ?? err}`)
    return
  }

  if (!due.length) return

  let closed = 0
  let noReserve = 0

  for (const auction of due) {
    const outcome = await runOnce(
      container,
      "close-auction",
      auction.id,
      async () => {
        // Re-read inside the claim. An extension may have moved the end
        // time since the batch was selected.
        const fresh = await svc.retrieveAuction(auction.id).catch(() => null)
        if (!fresh) return null
        if (new Date(fresh.ends_at) > new Date()) return null
        if (fresh.status !== "live" && fresh.status !== "ended") return null

        const { alreadyClosed, result } = await svc.closeAuction(auction.id)
        if (alreadyClosed) return null

        const to = result.winner_id ? "awaiting_winner_payment" : "reserve_not_met"

        await auctionMachine.record(container, {
          entityId: auction.id,
          action: "auction.closed",
          actor: SYSTEM_ACTOR,
          fromValue: fresh.status,
          toValue: to,
          metadata: {
            winner_id: result.winner_id,
            winning_amount: result.winning_amount,
            reserve_met: result.reserve_met,
            bid_count: result.bid_count,
          },
        })

        // §8.8 — losing bidders' deposits are released according to policy.
        await releaseLosingDeposits(container, auction.id, result.winner_id)

        if (result.winner_id) {
          // §8.9 — the winner gets a payment deadline and clear next steps,
          // and the unit stays reserved for them until they pay or expire.
          await createWinnerOffer(container, {
            auction: fresh,
            bidderId: result.winner_id,
            bidId: result.winning_bid_id,
            amount: Number(result.winning_amount),
            rank: 1,
          })
        } else {
          // Reserve not met: tell the bidders rather than leaving them
          // refreshing a dead page.
          await notifyReserveNotMet(container, auction.id)
        }

        return { winner: result.winner_id }
      },
      { ttlSeconds: 600 }
    ).catch((err: any) => {
      logger.error(`[close-auctions] ${auction.id}: ${err?.message ?? err}`)
      return null
    })

    if (!outcome) continue
    closed++
    if (!outcome.winner) noReserve++
  }

  if (closed) {
    logger.info(
      `[close-auctions] closed ${closed} auction(s), ${noReserve} without a winner`
    )
  }
}

/** Let everyone who bid know the reserve was not met. */
const notifyReserveNotMet = async (
  container: MedusaContainer,
  auctionId: string
): Promise<void> => {
  try {
    const svc: any = container.resolve(AUCTION_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const bids = await svc.listBids({ auction_id: auctionId }, { take: 200 })
    const bidderIds = [
      ...new Set((bids as any[]).filter((b) => !b.voided_at).map((b) => b.bidder_id)),
    ]
    if (!bidderIds.length) return

    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name"],
      filters: { id: bidderIds },
    })

    for (const customer of customers as any[]) {
      if (!customer.email) continue
      await sendNotification(container, {
        to: customer.email,
        channel: "email",
        template: "auction-reserve-not-met",
        triggerType: "auction.reserve_not_met",
        resourceId: auctionId,
        resourceType: "auction",
        content: {
          subject: "That auction ended without a sale",
          text:
            `Hi${customer.first_name ? ` ${customer.first_name}` : ""},\n\n` +
            `The auction you bid on has ended without reaching its reserve price, ` +
            `so the item wasn't sold. Any hold on your payment method has been released.\n\n` +
            `— Ceedmart`,
        },
      })
    }
  } catch {
    // Notification failure must never hold up a close.
  }
}

export const config = {
  name: "close-auctions",
  schedule: "* * * * *",
}
