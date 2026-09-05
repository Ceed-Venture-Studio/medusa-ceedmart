import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOLAR_MODULE } from "../modules/solar"
import { solarQuoteMachine } from "../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../lib/state-machine"
import { runOnce } from "../lib/jobs/idempotency"

// P0-5 — the first scheduled job in the codebase.
//
// It exists to prove the scheduling foundation end to end before Phase 4
// depends on it for auction closing: a job that runs on a timer, claims its
// work so concurrent instances and post-restart retries do not double-act,
// moves entities through the shared state machine, and leaves an audit row
// behind.
//
// The work itself is real but low-stakes: a solar quote nobody has
// progressed in SOLAR_QUOTE_EXPIRY_DAYS is marked lost, so the admin funnel
// reflects reality instead of accumulating stale "new" rows forever. If this
// misfires the cost is a wrongly-closed lead, not a wrongly-closed auction.

const DEFAULT_EXPIRY_DAYS = 30
const BATCH_LIMIT = 200

// Statuses a quote can sit in while still awaiting action. `quoted` is
// excluded deliberately — a quote that has been sent is a live commitment
// and only a human should close it.
const STALE_STATUSES = ["new", "contacted"]

export default async function expireSolarQuotesJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const solar: any = container.resolve(SOLAR_MODULE)

  const days = Number(process.env.SOLAR_QUOTE_EXPIRY_DAYS) || DEFAULT_EXPIRY_DAYS
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  let candidates: any[] = []
  try {
    candidates = await solar.listSolarQuotes(
      { status: STALE_STATUSES, created_at: { $lt: cutoff } },
      { take: BATCH_LIMIT, order: { created_at: "ASC" } }
    )
  } catch (err: any) {
    logger.error(`[expire-solar-quotes] query failed: ${err?.message ?? err}`)
    return
  }

  if (!candidates.length) return

  let expired = 0
  let skipped = 0

  for (const quote of candidates) {
    // Claimed per quote rather than per run, so two instances processing the
    // same batch split the work instead of duplicating it, and a crash
    // halfway through does not reprocess what already succeeded.
    const result = await runOnce(
      container,
      "expire-solar-quotes",
      quote.id,
      async () => {
        await solarQuoteMachine.transition(container, {
          entityId: quote.id,
          from: quote.status,
          to: "lost",
          actor: SYSTEM_ACTOR,
          reason: `No activity for ${days} days — expired automatically`,
        })
        await solar.updateSolarQuotes({ id: quote.id, status: "lost" })
        return true
      },
      // Held well past the per-quote runtime but far below the daily
      // interval, so a genuine retry tomorrow is never blocked.
      { ttlSeconds: 3600 }
    ).catch((err: any) => {
      logger.error(
        `[expire-solar-quotes] ${quote.id}: ${err?.message ?? err}`
      )
      return null
    })

    if (result) expired++
    else skipped++
  }

  logger.info(
    `[expire-solar-quotes] expired ${expired}, skipped ${skipped} (already claimed or failed), cutoff ${cutoff.toISOString()}`
  )
}

export const config = {
  name: "expire-solar-quotes",
  // 03:15 daily — off the hour so it does not contend with every other
  // system's on-the-hour work.
  schedule: "15 3 * * *",
}
