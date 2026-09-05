import type { MedusaContainer } from "@medusajs/framework/types"
import { JOB_CLAIM_MODULE } from "../../modules/job-claim"

// Run-once helpers for scheduled jobs (BRD §8.8, §10.5, §12.2).
//
// ── The problem ─────────────────────────────────────────────────────────
// Medusa's scheduler fires a job on every worker that has it registered.
// With more than one Cloud Run instance, "close auctions that have ended"
// runs concurrently on each. Without a shared guard, two instances can both
// decide the same auction has a winner, and both act on it. A retry after a
// crash has the same effect.
//
// §8.8 requires closing to be idempotent and safe if the closing job
// retries. That guarantee has to come from outside the process.
//
// ── Why the database and not the cache ──────────────────────────────────
// The obvious implementation is a cache key with a TTL. It is wrong here:
// Medusa's cache module exposes get/set/invalidate and no compare-and-set,
// so claiming is a read followed by a write. Two instances racing both read
// "free", both write, and both proceed — precisely the failure the claim
// exists to prevent. A unique index arbitrates atomically instead, and it
// also survives a Redis flush, which is exactly when a duplicate close would
// otherwise happen.
//
// This is still a lease, not a mutex. It prevents duplicate WORK. The
// correctness guarantee for anything that moves money stays in the database
// — a unique constraint, or SELECT ... FOR UPDATE (see the auction bid
// design in A5). Use both: an early-expiring lease should cost wasted
// effort, never corruption.

const DEFAULT_TTL_SECONDS = 300

export type ClaimOptions = {
  /** How long the claim is held. Set comfortably longer than the job's
   *  worst-case runtime, and shorter than its interval. */
  ttlSeconds?: number
}

/**
 * Try to claim a unit of work.
 *
 * Returns true if this process won the claim and should proceed, false if
 * another process (or an earlier, still-live run) holds it.
 *
 * Fails CLOSED — if the claim cannot be taken we return false and skip the
 * work. The database backing the claim is the same one the work writes to,
 * so if it is unreachable the work would fail anyway; proceeding blind would
 * only risk doing it twice.
 */
export const claim = async (
  container: MedusaContainer,
  scope: string,
  id: string,
  options: ClaimOptions = {}
): Promise<boolean> => {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS

  try {
    const claims: any = container.resolve(JOB_CLAIM_MODULE)
    return await claims.tryClaim(scope, id, ttl)
  } catch {
    return false
  }
}

/**
 * Release a claim early, so a retry can pick the work up immediately rather
 * than waiting out the TTL. Call this when work FAILS and should be retried;
 * never after success, or the TTL stops protecting you.
 */
export const release = async (
  container: MedusaContainer,
  scope: string,
  id: string
): Promise<void> => {
  try {
    const claims: any = container.resolve(JOB_CLAIM_MODULE)
    await claims.releaseClaim(scope, id)
  } catch {
    // The TTL will clear it.
  }
}

/**
 * Run `work` at most once per id.
 *
 * On failure the claim is released so the next tick retries, and the error
 * is rethrown for the caller to log. Returns null when the claim was not
 * won, which callers use to distinguish "someone else has it" from a result.
 */
export const runOnce = async <T>(
  container: MedusaContainer,
  scope: string,
  id: string,
  work: () => Promise<T>,
  options: ClaimOptions = {}
): Promise<T | null> => {
  const won = await claim(container, scope, id, options)
  if (!won) return null

  try {
    return await work()
  } catch (err) {
    await release(container, scope, id)
    throw err
  }
}
