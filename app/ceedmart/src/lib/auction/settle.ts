import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { AUCTION_MODULE } from "../../modules/auction"
import { sendNotification } from "../notifications/send"
import { rankedFallbackBidders } from "./rules"

// Settlement after an auction closes (BRD §8.8, §8.9).
//
// The rule that shapes everything here: §8.9 says the next-bidder offer
// "must be a NEW time-limited offer and must NOT silently charge that
// bidder". So nothing in this module moves money. It creates OFFERS —
// invitations with deadlines — and releases holds. Charging always requires
// the bidder to come back and pay.

const STOREFRONT_URL = (process.env.STORE_CORS || "https://ceedmart.com")
  .split(",")[0]
  .replace(/\/$/, "")

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString()}`

/**
 * Offer the item to a bidder, with a deadline (§8.9).
 *
 * The unit stays reserved for them until they pay or the window expires —
 * §8.9 requires exactly that, and it is why the offer table has a unique
 * index allowing only one pending offer per auction. The item cannot be
 * promised to two people at once.
 */
export const createWinnerOffer = async (
  container: MedusaContainer,
  args: {
    auction: any
    bidderId: string
    bidId: string | null
    amount: number
    rank: number
  }
): Promise<any | null> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(AUCTION_MODULE)

  const now = new Date()
  const hours = Number(args.auction.payment_window_hours ?? 24)
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000)

  try {
    const offer = await svc.createWinnerOffers({
      auction_id: args.auction.id,
      bidder_id: args.bidderId,
      bid_id: args.bidId,
      amount: args.amount,
      currency_code: args.auction.currency_code ?? "ngn",
      rank: args.rank,
      offered_at: now,
      expires_at: expiresAt,
      status: "pending",
    })

    await notifyOffer(container, {
      auction: args.auction,
      offer,
      isFallback: args.rank > 1,
    })

    return offer
  } catch (err: any) {
    // The unique index refused a second pending offer — something else got
    // there first, which is the index doing its job.
    logger.error(
      `[auction-settle] could not create offer for ${args.auction.id}: ${err?.message ?? err}`
    )
    return null
  }
}

const notifyOffer = async (
  container: MedusaContainer,
  args: { auction: any; offer: any; isFallback: boolean }
): Promise<void> => {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name"],
      filters: { id: args.offer.bidder_id },
    })

    const customer = (customers as any[])[0]
    if (!customer?.email) return

    const deadline = new Date(args.offer.expires_at).toLocaleString("en-NG", {
      dateStyle: "full",
      timeStyle: "short",
    })

    const text = args.isFallback
      ? [
          `Hi${customer.first_name ? ` ${customer.first_name}` : ""},`,
          ``,
          `The winning bidder for "${args.auction.title}" didn't complete payment, ` +
            `so we're offering it to you at your bid of ${naira(Number(args.offer.amount))}.`,
          ``,
          `This is an offer, not a charge — nothing has been taken from your account. ` +
            `If you'd like the item, pay by ${deadline}.`,
          ``,
          `${STOREFRONT_URL}/auctions/${args.auction.reference}/pay`,
          ``,
          `— Ceedmart`,
        ].join("\n")
      : [
          `Hi${customer.first_name ? ` ${customer.first_name}` : ""},`,
          ``,
          `You won "${args.auction.title}" at ${naira(Number(args.offer.amount))}.`,
          ``,
          `Please pay by ${deadline} to complete the purchase. We're holding the ` +
            `item for you until then.`,
          ``,
          `${STOREFRONT_URL}/auctions/${args.auction.reference}/pay`,
          ``,
          `— Ceedmart`,
        ].join("\n")

    await sendNotification(container, {
      to: customer.email,
      channel: "email",
      template: args.isFallback ? "auction-next-bidder-offer" : "auction-won",
      triggerType: args.isFallback ? "auction.offered_to_next" : "auction.won",
      resourceId: args.auction.id,
      resourceType: "auction",
      correlationId: args.auction.id,
      content: {
        subject: args.isFallback
          ? `"${args.auction.title}" is available — your bid stands`
          : `You won "${args.auction.title}"`,
        text,
        html: text.replace(/\n/g, "<br/>"),
      },
    })
  } catch {
    // A failed notification must not roll back the offer.
  }
}

/**
 * Release holds for everyone who did not win (§8.8).
 *
 * A hold that was authorised but never captured is money we never took, so
 * releasing it is a distinct event from a refund and is recorded as such.
 * Nobody should have funds tied up on an auction they lost.
 */
export const releaseLosingDeposits = async (
  container: MedusaContainer,
  auctionId: string,
  winnerId: string | null
): Promise<void> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const svc: any = container.resolve(AUCTION_MODULE)
    const deposits = await svc.listBidderDeposits(
      { auction_id: auctionId, status: "authorized" },
      { take: 500 }
    )

    for (const deposit of deposits as any[]) {
      // The winner's hold stays until they pay or default.
      if (winnerId && deposit.bidder_id === winnerId) continue

      await svc.updateBidderDeposits({
        id: deposit.id,
        status: "released",
        released_at: new Date(),
      })
    }
  } catch (err: any) {
    logger.error(
      `[auction-settle] releasing deposits for ${auctionId}: ${err?.message ?? err}`
    )
  }
}

/**
 * Hand the item to the next eligible bidder after a default (§8.9).
 *
 * Returns null when there is nobody left, which is the signal to relist.
 * Every bidder already offered is excluded, so the item is never offered to
 * the same person twice, and bidders below the reserve are skipped — the
 * reserve applied at close still applies now.
 */
export const offerToNextBidder = async (
  container: MedusaContainer,
  auctionId: string
): Promise<any | null> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const svc: any = container.resolve(AUCTION_MODULE)

    const auction = await svc.retrieveAuction(auctionId).catch(() => null)
    if (!auction) return null

    const [bids, offers] = await Promise.all([
      svc.listBids({ auction_id: auctionId }, { take: 500 }),
      svc.listWinnerOffers({ auction_id: auctionId }, { take: 100 }),
    ])

    // Everyone who has already had their chance.
    const alreadyOffered = (offers as any[]).map((o) => o.bidder_id)

    const ranked = rankedFallbackBidders(
      (bids as any[]).map((b) => ({
        id: b.id,
        bidder_id: b.bidder_id,
        amount: Number(b.amount),
        placed_at: b.placed_at,
        sequence: b.sequence,
        voided_at: b.voided_at,
      })),
      alreadyOffered,
      auction.reserve_price === null ? null : Number(auction.reserve_price)
    )

    const next = ranked[0]
    if (!next) return null

    // Skip anyone barred since they bid.
    const [eligibility] = await svc.listBidderEligibilities(
      { customer_id: next.bidder_id },
      { take: 1 }
    )
    if (eligibility?.is_barred) {
      logger.info(
        `[auction-settle] skipping barred fallback bidder on ${auctionId}`
      )
      return await offerToNextBidderExcluding(container, auctionId, [
        ...alreadyOffered,
        next.bidder_id,
      ])
    }

    return await createWinnerOffer(container, {
      auction,
      bidderId: next.bidder_id,
      bidId: next.id,
      amount: next.amount,
      rank: alreadyOffered.length + 1,
    })
  } catch (err: any) {
    logger.error(
      `[auction-settle] offering to next bidder on ${auctionId}: ${err?.message ?? err}`
    )
    return null
  }
}

/** Recursion helper for skipping barred bidders without losing the exclusion
 *  list. Kept separate so the common path above stays readable. */
const offerToNextBidderExcluding = async (
  container: MedusaContainer,
  auctionId: string,
  excluded: string[]
): Promise<any | null> => {
  const svc: any = container.resolve(AUCTION_MODULE)

  const auction = await svc.retrieveAuction(auctionId).catch(() => null)
  if (!auction) return null

  const bids = await svc.listBids({ auction_id: auctionId }, { take: 500 })
  const ranked = rankedFallbackBidders(
    (bids as any[]).map((b) => ({
      id: b.id,
      bidder_id: b.bidder_id,
      amount: Number(b.amount),
      placed_at: b.placed_at,
      sequence: b.sequence,
      voided_at: b.voided_at,
    })),
    excluded,
    auction.reserve_price === null ? null : Number(auction.reserve_price)
  )

  const next = ranked[0]
  if (!next) return null

  return await createWinnerOffer(container, {
    auction,
    bidderId: next.bidder_id,
    bidId: next.id,
    amount: next.amount,
    rank: excluded.length + 1,
  })
}
