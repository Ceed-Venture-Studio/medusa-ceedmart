import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../modules/auction"
import { auctionMachine } from "../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../lib/state-machine"
import { runOnce } from "../lib/jobs/idempotency"
import { sendNotification } from "../lib/notifications/send"
import { offerToNextBidder } from "../lib/auction/settle"

// P4-8 / P4-9 — chase and expire winner payment windows (BRD §8.9).
//
// "The system sends reminders before expiry." "Until paid or expired, the
// unique inventory unit is reserved for the winner." "If the winner
// defaults, administrators can apply a disclosed penalty, retain an allowed
// deposit, offer the item to the next eligible bidder, or relist it."
//
// What this job does NOT do: charge anybody. §8.9 is explicit that the
// next-bidder offer "must not silently charge that bidder", and the same
// restraint applies to the original winner. Defaulting forfeits a deposit
// that was already authorised — it never initiates a new payment.

const BATCH_LIMIT = 200
// Fractions of the payment window at which to nudge. With a 24h window that
// is roughly 12h and 4h remaining.
const REMINDER_POINTS = [0.5, 0.85]

const STOREFRONT_URL = (process.env.STORE_CORS || "https://ceedmart.com")
  .split(",")[0]
  .replace(/\/$/, "")

export default async function expireWinnerOffersJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(AUCTION_MODULE)
  const now = new Date()

  let offers: any[] = []
  try {
    offers = await svc.listWinnerOffers({ status: "pending" }, { take: BATCH_LIMIT })
  } catch (err: any) {
    logger.error(`[expire-winner-offers] query failed: ${err?.message ?? err}`)
    return
  }

  if (!offers.length) return

  let expired = 0
  let reminded = 0

  for (const offer of offers) {
    const expiresAt = new Date(offer.expires_at)
    const offeredAt = new Date(offer.offered_at)

    // ── Still time left: nudge if we have reached a reminder point ──
    if (expiresAt > now) {
      const total = expiresAt.getTime() - offeredAt.getTime()
      const elapsed = now.getTime() - offeredAt.getTime()
      const progress = total > 0 ? elapsed / total : 1

      const due = REMINDER_POINTS.filter((p) => progress >= p).length
      if (due <= (offer.reminders_sent ?? 0)) continue

      // Claimed per reminder number, so a job re-run inside the same window
      // cannot nag someone twice for the same milestone.
      const sent = await runOnce(
        container,
        `remind-winner-${due}`,
        offer.id,
        async () => {
          await notifyWinner(container, offer, "reminder", expiresAt)
          await svc.updateWinnerOffers({
            id: offer.id,
            reminders_sent: due,
            last_reminder_at: now,
          })
          return true
        },
        { ttlSeconds: 6 * 3600 }
      ).catch((err: any) => {
        logger.error(`[expire-winner-offers] remind ${offer.id}: ${err?.message ?? err}`)
        return null
      })

      if (sent) reminded++
      continue
    }

    // ── Window elapsed: default ─────────────────────────────────────
    const handled = await runOnce(
      container,
      "expire-winner-offer",
      offer.id,
      async () => {
        // Re-read: they may have paid between the query and here.
        const fresh = await svc.retrieveWinnerOffer(offer.id).catch(() => null)
        if (!fresh || fresh.status !== "pending") return null

        await svc.updateWinnerOffers({ id: offer.id, status: "expired" })

        const auction = await svc.retrieveAuction(offer.auction_id).catch(() => null)
        if (!auction) return null

        // §8.9 — a disclosed deposit may be retained. Only ever a deposit
        // that was already authorised; nothing new is charged.
        const [deposit] = await svc.listBidderDeposits(
          { auction_id: offer.auction_id, bidder_id: offer.bidder_id },
          { take: 1 }
        )
        if (deposit && deposit.status === "authorized") {
          await svc.updateBidderDeposits({
            id: deposit.id,
            status: "forfeited",
            forfeited_at: new Date(),
            forfeit_reason: "Winner did not pay within the payment window",
          })
        }

        // Count the default against the bidder — repeated defaults are what
        // the barring policy exists for.
        const [eligibility] = await svc.listBidderEligibilities(
          { customer_id: offer.bidder_id },
          { take: 1 }
        )
        if (eligibility) {
          await svc.updateBidderEligibilities({
            id: eligibility.id,
            default_count: (eligibility.default_count ?? 0) + 1,
          })
        }

        if (auctionMachine.canTransition(auction.status, "winner_defaulted")) {
          await auctionMachine.transition(container, {
            entityId: auction.id,
            from: auction.status,
            to: "winner_defaulted",
            actor: SYSTEM_ACTOR,
            reason: "Payment window elapsed without payment",
            correlationId: auction.id,
          })
          await svc.updateAuctions({ id: auction.id, status: "winner_defaulted" })
        }

        await notifyWinner(container, offer, "expired", new Date(offer.expires_at))

        // §8.9 — offer to the next eligible bidder, or leave it for an
        // administrator to relist. A new time-limited offer, never a charge.
        const next = await offerToNextBidder(container, auction.id)
        if (next) {
          await auctionMachine.transition(container, {
            entityId: auction.id,
            from: "winner_defaulted",
            to: "offered_to_next_bidder",
            actor: SYSTEM_ACTOR,
            reason: "Offered to the next eligible bidder",
            correlationId: auction.id,
          })
          await svc.updateAuctions({
            id: auction.id,
            status: "offered_to_next_bidder",
          })
        } else {
          logger.info(
            `[expire-winner-offers] ${auction.id} has no eligible fallback bidder — needs relisting`
          )
        }

        return true
      },
      { ttlSeconds: 3600 }
    ).catch((err: any) => {
      logger.error(`[expire-winner-offers] ${offer.id}: ${err?.message ?? err}`)
      return null
    })

    if (handled) expired++
  }

  if (expired || reminded) {
    logger.info(
      `[expire-winner-offers] ${expired} expired, ${reminded} reminded of ${offers.length} pending`
    )
  }
}

const notifyWinner = async (
  container: MedusaContainer,
  offer: any,
  kind: "reminder" | "expired",
  deadline: Date
): Promise<void> => {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const svc: any = container.resolve(AUCTION_MODULE)

    const [{ data: customers }, auction] = await Promise.all([
      query.graph({
        entity: "customer",
        fields: ["id", "email", "first_name"],
        filters: { id: offer.bidder_id },
      }),
      svc.retrieveAuction(offer.auction_id).catch(() => null),
    ])

    const customer = (customers as any[])[0]
    if (!customer?.email || !auction) return

    const amount = `₦${(Number(offer.amount) / 100).toLocaleString()}`
    const when = deadline.toLocaleString("en-NG", {
      dateStyle: "full",
      timeStyle: "short",
    })

    const text =
      kind === "reminder"
        ? [
            `Hi${customer.first_name ? ` ${customer.first_name}` : ""},`,
            ``,
            `A reminder that payment for "${auction.title}" (${amount}) is due by ${when}.`,
            ``,
            `We're holding the item for you until then.`,
            ``,
            `${STOREFRONT_URL}/auctions/${auction.reference}/pay`,
            ``,
            `— Ceedmart`,
          ].join("\n")
        : [
            `Hi${customer.first_name ? ` ${customer.first_name}` : ""},`,
            ``,
            `The payment window for "${auction.title}" has closed, so we've released ` +
              `the item. If this was a mistake, get in touch and we'll see what we can do.`,
            ``,
            `— Ceedmart`,
          ].join("\n")

    await sendNotification(container, {
      to: customer.email,
      channel: "email",
      template: kind === "reminder" ? "auction-payment-reminder" : "auction-payment-expired",
      triggerType: `auction.payment_${kind}`,
      resourceId: offer.auction_id,
      resourceType: "auction",
      correlationId: offer.auction_id,
      content: {
        subject:
          kind === "reminder"
            ? `Payment due for "${auction.title}"`
            : `Your payment window for "${auction.title}" has closed`,
        text,
        html: text.replace(/\n/g, "<br/>"),
      },
    })
  } catch {
    // Never hold up an expiry on a notification.
  }
}

export const config = {
  name: "expire-winner-offers",
  // Every five minutes. A payment window is measured in hours, so this is
  // frequent enough to be prompt without polling pointlessly.
  schedule: "*/5 * * * *",
}
