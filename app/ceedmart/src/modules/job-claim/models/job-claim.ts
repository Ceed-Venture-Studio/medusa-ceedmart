import { model } from "@medusajs/framework/utils"

// A lease on one unit of scheduled work.
//
// Lives in Postgres rather than the cache because the claim has to be
// ATOMIC. Medusa's cache module exposes only get/set/invalidate — no
// compare-and-set — so a cache-based claim is a read followed by a write,
// and two instances racing both read "free" and both write. A unique
// constraint does not have that problem.
//
// It also survives a Redis flush, which matters: losing every claim at once
// is exactly the moment a duplicate auction close would happen.

const JobClaim = model
  .define("JobClaim", {
    id: model.id({ prefix: "jclm" }).primaryKey(),
    // The job that owns the claim, e.g. "close-auctions".
    scope: model.text(),
    // The unit of work — usually an entity id.
    work_id: model.text(),
    claimed_at: model.dateTime(),
    // Past this, another instance may take the claim over. Set comfortably
    // longer than the work's worst case and shorter than the job interval.
    expires_at: model.dateTime(),
  })
  .indexes([
    { on: ["scope", "work_id"], unique: true },
    { on: ["expires_at"] },
  ])

export default JobClaim
