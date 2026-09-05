import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../modules/build"
import { buildOrderMachine } from "../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../lib/state-machine"
import { runOnce } from "../lib/jobs/idempotency"
import { sendNotification } from "../lib/notifications/send"

// P2-7 — close out build quotes whose validity window has passed.
//
// §7.6 requires quotes to carry an expiry, and §7.9 that "estimates are not
// binding until an authorised quote is accepted". A quote left open
// indefinitely is a standing offer at last quarter's component prices, on
// parts whose availability we last checked weeks ago.
//
// This runs on the P0 scheduler and claims each quote individually, so two
// instances split the batch rather than both expiring the same quote — and
// a crash halfway through does not reprocess what already succeeded.
//
// It also warns before expiring. A customer who is still deciding should
// get a nudge rather than discover the quote died overnight.

const BATCH_LIMIT = 200
const WARN_DAYS_BEFORE = Number(process.env.BUILD_QUOTE_WARN_DAYS || 2)

const STOREFRONT_URL = (process.env.STORE_CORS || "https://ceedmart.com")
  .split(",")[0]
  .replace(/\/$/, "")

export default async function expireBuildQuotesJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(BUILD_MODULE)

  const now = new Date()

  // Only quotes actually awaiting a decision. A draft was never sent, and an
  // accepted or rejected quote is already closed.
  let quotes: any[] = []
  try {
    quotes = await svc.listBuildQuotes({ status: "sent" }, { take: BATCH_LIMIT })
  } catch (err: any) {
    logger.error(`[expire-build-quotes] query failed: ${err?.message ?? err}`)
    return
  }

  if (!quotes.length) return

  let expired = 0
  let warned = 0

  for (const quote of quotes) {
    if (!quote.current_version_id) continue

    const version = await svc
      .retrieveBuildQuoteVersion(quote.current_version_id)
      .catch(() => null)
    if (!version?.valid_until) continue

    const validUntil = new Date(version.valid_until)
    const msLeft = validUntil.getTime() - now.getTime()
    const daysLeft = msLeft / (24 * 60 * 60 * 1000)

    if (msLeft > 0 && daysLeft > WARN_DAYS_BEFORE) continue

    const request = await svc.retrieveBuildRequest(quote.request_id).catch(() => null)

    // ── Still valid, but closing soon: nudge once ────────────────
    if (msLeft > 0) {
      const sent = await runOnce(
        container,
        "warn-build-quote",
        quote.id,
        async () => {
          if (!request?.customer_email) return false
          await sendNotification(container, {
            to: request.customer_email,
            channel: "email",
            template: "build-quote-expiring",
            triggerType: "build.quote_expiring",
            resourceId: quote.id,
            resourceType: "build_quote",
            correlationId: quote.request_id,
            content: {
              subject: `Your build quote ${quote.reference} expires soon`,
              text:
                `Hi ${request.customer_name},\n\n` +
                `Your quote ${quote.reference} is valid until ${validUntil.toDateString()}. ` +
                `Component prices move, so after that we'd need to prepare a fresh one.\n\n` +
                `Review it here: ${STOREFRONT_URL}/builds/${quote.reference}\n\n— Ceedmart`,
            },
          })
          return true
        },
        // Held well past the warning so a daily run does not nudge twice.
        { ttlSeconds: 14 * 24 * 3600 }
      ).catch((err: any) => {
        logger.error(`[expire-build-quotes] warn ${quote.id}: ${err?.message ?? err}`)
        return null
      })

      if (sent) warned++
      continue
    }

    // ── Past validity: expire it ─────────────────────────────────
    const result = await runOnce(
      container,
      "expire-build-quote",
      quote.id,
      async () => {
        await svc.updateBuildQuotes({ id: quote.id, status: "expired" })

        if (request && buildOrderMachine.canTransition(request.status, "quote_expired")) {
          await buildOrderMachine.transition(container, {
            entityId: request.id,
            from: request.status,
            to: "quote_expired",
            actor: SYSTEM_ACTOR,
            reason: `Quote ${quote.reference} passed its validity date`,
            correlationId: request.id,
          })
          await svc.updateBuildRequests({ id: request.id, status: "quote_expired" })
        }

        if (request?.customer_email) {
          await sendNotification(container, {
            to: request.customer_email,
            channel: "email",
            template: "build-quote-expired",
            triggerType: "build.quote_expired",
            resourceId: quote.id,
            resourceType: "build_quote",
            correlationId: quote.request_id,
            content: {
              subject: `Your build quote ${quote.reference} has expired`,
              text:
                `Hi ${request.customer_name},\n\n` +
                `Quote ${quote.reference} has expired. If you're still interested, reply and ` +
                `we'll price it again at today's component costs — it may have moved either way.\n\n— Ceedmart`,
            },
          })
        }

        return true
      },
      { ttlSeconds: 24 * 3600 }
    ).catch((err: any) => {
      logger.error(`[expire-build-quotes] ${quote.id}: ${err?.message ?? err}`)
      return null
    })

    if (result) expired++
  }

  if (expired || warned) {
    logger.info(
      `[expire-build-quotes] expired ${expired}, warned ${warned} of ${quotes.length} open quotes`
    )
  }
}

export const config = {
  name: "expire-build-quotes",
  // 04:15 daily — after the solar quote sweep, off the hour.
  schedule: "15 4 * * *",
}
