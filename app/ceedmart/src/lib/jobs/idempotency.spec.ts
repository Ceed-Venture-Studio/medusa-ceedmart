import { claim, release, runOnce } from "./idempotency"

// Stand-in for the job_claim table.
//
// The important property is that tryClaim resolves the whole decision in one
// step, the way `insert ... on conflict do update ... where expires_at <= now
// returning id` does in Postgres. Because JavaScript runs this synchronously
// within a single call, two concurrent callers cannot interleave a read and
// a write — which is exactly the guarantee the unique index provides.
//
// An earlier cache-based implementation did a get and then a set. These
// tests failed against it, which is the whole reason the claim moved into
// the database.
const makeClaimStore = () => {
  const rows = new Map<string, { expiresAt: number }>()

  const service = {
    tryClaim: async (scope: string, workId: string, ttlSeconds: number) => {
      const key = `${scope}:${workId}`
      const existing = rows.get(key)
      const now = Date.now()

      // A live claim belongs to someone else.
      if (existing && existing.expiresAt > now) return false

      rows.set(key, { expiresAt: now + ttlSeconds * 1000 })
      return true
    },
    releaseClaim: async (scope: string, workId: string) => {
      rows.delete(`${scope}:${workId}`)
    },
  }

  // Each "instance" is its own container resolving the same table.
  const instance = () => ({ resolve: () => service }) as any

  return { rows, instance }
}

const brokenContainer = () =>
  ({
    resolve: () => {
      throw new Error("database unreachable")
    },
  }) as any

describe("job claims", () => {
  it("lets the first caller through", async () => {
    const { instance } = makeClaimStore()

    expect(await claim(instance(), "close-auctions", "auc_1")).toBe(true)
  })

  it("refuses a second caller for the same work", async () => {
    const { instance } = makeClaimStore()

    expect(await claim(instance(), "close-auctions", "auc_1")).toBe(true)
    expect(await claim(instance(), "close-auctions", "auc_1")).toBe(false)
  })

  it("produces exactly one winner when two instances race", async () => {
    const { instance } = makeClaimStore()

    const results = await Promise.all([
      claim(instance(), "close-auctions", "auc_1"),
      claim(instance(), "close-auctions", "auc_1"),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it("produces exactly one winner across many instances", async () => {
    const { instance } = makeClaimStore()

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        claim(instance(), "close-auctions", "auc_1")
      )
    )

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it("keeps different work items independent", async () => {
    const { instance } = makeClaimStore()
    const c = instance()

    expect(await claim(c, "close-auctions", "auc_1")).toBe(true)
    expect(await claim(c, "close-auctions", "auc_2")).toBe(true)
  })

  it("keeps different job scopes independent", async () => {
    const { instance } = makeClaimStore()
    const c = instance()

    expect(await claim(c, "close-auctions", "id_1")).toBe(true)
    expect(await claim(c, "expire-quotes", "id_1")).toBe(true)
  })

  it("frees the work again after an explicit release", async () => {
    const { instance } = makeClaimStore()
    const c = instance()

    await claim(c, "close-auctions", "auc_1")
    await release(c, "close-auctions", "auc_1")

    expect(await claim(c, "close-auctions", "auc_1")).toBe(true)
  })

  it("fails closed when the claim store is unreachable", async () => {
    // The claim lives in the same database the work writes to. If it is
    // unreachable the work would fail anyway, so skipping is strictly safer
    // than proceeding blind and risking a double execution.
    expect(await claim(brokenContainer(), "close-auctions", "auc_1")).toBe(
      false
    )
  })
})

describe("runOnce", () => {
  it("performs the work exactly once across a restart-style retry", async () => {
    const { instance } = makeClaimStore()
    const c = instance()
    let runs = 0

    const work = async () => {
      runs++
      return "closed"
    }

    const first = await runOnce(c, "close-auctions", "auc_1", work)
    // Simulates the instance restarting and the schedule firing again.
    const second = await runOnce(c, "close-auctions", "auc_1", work)

    expect(first).toBe("closed")
    expect(second).toBeNull()
    expect(runs).toBe(1)
  })

  it("performs the work once when two instances race", async () => {
    const { instance } = makeClaimStore()
    let runs = 0

    const work = async () => {
      runs++
      return true
    }

    await Promise.all([
      runOnce(instance(), "close-auctions", "auc_1", work),
      runOnce(instance(), "close-auctions", "auc_1", work),
    ])

    expect(runs).toBe(1)
  })

  it("releases the claim when the work throws, so the next tick retries", async () => {
    const { instance } = makeClaimStore()
    const c = instance()
    let attempts = 0

    const flaky = async () => {
      attempts++
      if (attempts === 1) throw new Error("supplier API down")
      return "recovered"
    }

    await expect(runOnce(c, "close-auctions", "auc_1", flaky)).rejects.toThrow(
      "supplier API down"
    )

    expect(await runOnce(c, "close-auctions", "auc_1", flaky)).toBe("recovered")
    expect(attempts).toBe(2)
  })

  it("holds the claim after success so a retry does not repeat the work", async () => {
    const { instance } = makeClaimStore()
    const c = instance()
    let runs = 0
    const work = async () => {
      runs++
      return true
    }

    await runOnce(c, "close-auctions", "auc_1", work)
    await runOnce(c, "close-auctions", "auc_1", work)

    expect(runs).toBe(1)
  })

  it("lets the work run again once the claim TTL has expired", async () => {
    const { instance } = makeClaimStore()
    const c = instance()
    let runs = 0
    const work = async () => {
      runs++
      return true
    }

    const now = Date.now()
    const spy = jest.spyOn(Date, "now")

    spy.mockReturnValue(now)
    await runOnce(c, "close-auctions", "auc_1", work, { ttlSeconds: 60 })

    // Two minutes later the lease is stale and the work is claimable again.
    spy.mockReturnValue(now + 120_000)
    await runOnce(c, "close-auctions", "auc_1", work, { ttlSeconds: 60 })

    spy.mockRestore()
    expect(runs).toBe(2)
  })

  it("does not let a live claim be stolen before its TTL", async () => {
    const { instance } = makeClaimStore()
    const c = instance()
    let runs = 0
    const work = async () => {
      runs++
      return true
    }

    const now = Date.now()
    const spy = jest.spyOn(Date, "now")

    spy.mockReturnValue(now)
    await runOnce(c, "close-auctions", "auc_1", work, { ttlSeconds: 600 })

    spy.mockReturnValue(now + 120_000)
    await runOnce(c, "close-auctions", "auc_1", work, { ttlSeconds: 600 })

    spy.mockRestore()
    expect(runs).toBe(1)
  })
})
