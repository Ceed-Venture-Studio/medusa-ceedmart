import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"
import JobClaim from "./models/job-claim"

export default class JobClaimModuleService extends MedusaService({
  JobClaim,
}) {
  /**
   * Atomically take the claim on a unit of work.
   *
   * Returns true only if this caller now holds it. The whole decision is one
   * statement, so two instances issuing it concurrently produce exactly one
   * winner — Postgres serialises them on the unique index.
   *
   * `ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now` is what makes an
   * expired lease reclaimable: the update only fires for a stale row, and
   * RETURNING yields nothing when the existing claim is still live.
   */
  @InjectManager()
  async tryClaim(
    scope: string,
    workId: string,
    ttlSeconds: number,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<boolean> {
    const manager: any = (sharedContext as any).manager
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
    const id = `jclm_${scope}_${workId}`.slice(0, 120)

    const rows = await manager.execute(
      `insert into "job_claim"
         ("id", "scope", "work_id", "claimed_at", "expires_at", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, now(), now())
       on conflict ("scope", "work_id") do update
         set "claimed_at" = excluded."claimed_at",
             "expires_at" = excluded."expires_at",
             "updated_at" = now()
         where "job_claim"."expires_at" <= ?
       returning "id"`,
      [id, scope, workId, now, expiresAt, now]
    )

    return Array.isArray(rows) ? rows.length > 0 : !!rows
  }

  /**
   * Give the claim up early so a retry can pick the work straight up rather
   * than waiting out the TTL. Only call this after a FAILURE — releasing
   * after success removes the very protection the claim provides.
   */
  @InjectManager()
  async releaseClaim(
    scope: string,
    workId: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const manager: any = (sharedContext as any).manager
    await manager.execute(
      `delete from "job_claim" where "scope" = ? and "work_id" = ?`,
      [scope, workId]
    )
  }

  /** Housekeeping: drop leases that expired long ago. */
  @InjectManager()
  async pruneExpiredClaims(
    olderThan: Date,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const manager: any = (sharedContext as any).manager
    await manager.execute(
      `delete from "job_claim" where "expires_at" <= ?`,
      [olderThan]
    )
  }
}
