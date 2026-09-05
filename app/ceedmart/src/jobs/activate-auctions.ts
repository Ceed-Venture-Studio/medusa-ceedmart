import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../modules/auction"
import { auctionMachine } from "../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../lib/state-machine"
import { runOnce } from "../lib/jobs/idempotency"

// P4-6 — open auctions whose start time has passed (BRD §8.5).
//
// Runs every minute. Activation is driven by the scheduler and never by an
// operator, so an auction opens when it said it would even if nobody is
// watching.
//
// Each auction is claimed individually, so two instances split the batch
// rather than both activating the same row, and a crash mid-batch does not
// reprocess what already succeeded.

const BATCH_LIMIT = 200

export default async function activateAuctionsJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(AUCTION_MODULE)
  const now = new Date()

  let due: any[] = []
  try {
    due = await svc.listAuctions(
      { status: "scheduled", starts_at: { $lte: now } },
      { take: BATCH_LIMIT, order: { starts_at: "ASC" } }
    )
  } catch (err: any) {
    logger.error(`[activate-auctions] query failed: ${err?.message ?? err}`)
    return
  }

  if (!due.length) return

  let activated = 0

  for (const auction of due) {
    // An auction whose whole window elapsed while we were down should not
    // open — the closing job will take it straight to ended.
    if (new Date(auction.ends_at) <= now) continue

    const result = await runOnce(
      container,
      "activate-auction",
      auction.id,
      async () => {
        await auctionMachine.transition(container, {
          entityId: auction.id,
          from: auction.status,
          to: "live",
          actor: SYSTEM_ACTOR,
        })
        await svc.updateAuctions({
          id: auction.id,
          status: "live",
          // Frozen before anti-sniping can move ends_at, so an extended
          // auction can still show how far past its advertised close it ran.
          original_ends_at: auction.original_ends_at ?? auction.ends_at,
        })
        return true
      },
      { ttlSeconds: 300 }
    ).catch((err: any) => {
      logger.error(`[activate-auctions] ${auction.id}: ${err?.message ?? err}`)
      return null
    })

    if (result) activated++
  }

  if (activated) {
    logger.info(`[activate-auctions] opened ${activated} auction(s)`)
  }
}

export const config = {
  name: "activate-auctions",
  // Every minute. An auction advertised to open at 14:00 must not open at
  // 14:05 — bidders arrive on time.
  schedule: "* * * * *",
}
