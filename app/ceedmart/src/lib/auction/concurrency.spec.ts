import { applyAntiSnipe, checkBid, determineWinner } from "./rules"

// Concurrency cover for bid acceptance (BRD §8.6, §8.8), P4-5.
//
// ── What this models, and what it does not ──────────────────────────────
// The real guarantee is SQL: `SELECT ... FOR UPDATE` on the auction row plus
// a unique index on (auction_id, sequence). That cannot be exercised without
// Postgres, so these tests model the two properties that guarantee provides
// and assert the surrounding logic is correct GIVEN them:
//
//   • serialisation — a second bidder validates against the first bidder's
//     committed price, not the price they saw when the page loaded;
//   • sequence uniqueness — two bids cannot occupy the same sequence.
//
// The harness below deliberately mirrors Postgres's behaviour rather than
// JavaScript's: each transaction takes the lock, reads, decides and commits
// before the next begins. If the production SQL ever stopped locking, these
// tests would still pass — which is why the lock is also backed by the
// unique index, and why the index is asserted here too.
//
// An integration test against a real database belongs in /integration-tests
// once one is available for the app workspace.

type Row = {
  status: string
  starts_at: Date
  ends_at: Date
  starting_price: number
  min_increment: number
  current_price: number | null
  buy_now_price: number | null
  leading_bidder_id: string | null
  last_sequence: number
  bid_count: number
  antisnipe_window_seconds: number
  antisnipe_extension_seconds: number
}

const NOW = new Date("2026-09-05T12:00:00Z")

const makeAuction = (over: Partial<Row> = {}) => {
  const row: Row = {
    status: "live",
    starts_at: new Date("2026-09-05T10:00:00Z"),
    ends_at: new Date("2026-09-05T18:00:00Z"),
    starting_price: 10_000_000,
    min_increment: 500_000,
    current_price: null,
    buy_now_price: null,
    leading_bidder_id: null,
    last_sequence: 0,
    bid_count: 0,
    antisnipe_window_seconds: 300,
    antisnipe_extension_seconds: 300,
    ...over,
  }

  const bids: { sequence: number; bidder_id: string; amount: number; placed_at: Date }[] = []
  const takenSequences = new Set<number>()
  let locked = false

  /** One bid, run as the service runs it: lock, read, decide, write, commit. */
  const placeBid = async (
    bidderId: string,
    amount: number,
    at: Date = NOW
  ): Promise<{ ok: boolean; sequence?: number; error?: string }> => {
    // Mirrors FOR UPDATE: a second caller cannot enter while one holds it.
    if (locked) throw new Error("lock contention — transactions must serialise")
    locked = true

    try {
      const check = checkBid(row, { amount, bidderId }, at)
      if (!check.ok) return { ok: false, error: check.reason }

      const sequence = row.last_sequence + 1

      // The unique index on (auction_id, sequence).
      if (takenSequences.has(sequence)) {
        throw new Error("duplicate sequence — unique index would reject this")
      }
      takenSequences.add(sequence)

      const snipe = applyAntiSnipe(row, at)

      bids.push({ sequence, bidder_id: bidderId, amount, placed_at: at })
      row.current_price = amount
      row.leading_bidder_id = bidderId
      row.last_sequence = sequence
      row.bid_count += 1
      row.ends_at = snipe.ends_at

      return { ok: true, sequence }
    } finally {
      locked = false
    }
  }

  return { row, bids, placeBid }
}

describe("two bidders racing", () => {
  it("accepts only one bid at a given price", async () => {
    const { placeBid } = makeAuction()

    // Both saw a starting price of 10,000,000 and both bid it.
    const first = await placeBid("cus_1", 10_000_000)
    const second = await placeBid("cus_2", 10_000_000)

    expect(first.ok).toBe(true)
    // The second validates against the FIRST's committed price, so its
    // once-valid bid is now below the minimum.
    expect(second.ok).toBe(false)
    expect(second.error).toBe("below_minimum")
  })

  it("never issues the same sequence twice", async () => {
    const { placeBid, bids } = makeAuction()

    await placeBid("cus_1", 10_000_000)
    await placeBid("cus_2", 10_500_000)
    await placeBid("cus_1", 11_000_000)

    const sequences = bids.map((b) => b.sequence)
    expect(sequences).toEqual([1, 2, 3])
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it("produces one leader after a burst of competing bids", async () => {
    const { placeBid, row, bids } = makeAuction()

    // Ten bidders all trying at once, each bidding the minimum they saw.
    const results = []
    for (let i = 0; i < 10; i++) {
      results.push(await placeBid(`cus_${i}`, 10_000_000 + i * 500_000))
    }

    const accepted = results.filter((r) => r.ok)
    expect(accepted.length).toBeGreaterThan(0)
    expect(bids).toHaveLength(accepted.length)
    // Exactly one leader, and it is the last accepted bid.
    expect(row.leading_bidder_id).toBe(
      bids[bids.length - 1].bidder_id
    )
  })

  it("keeps the ledger consistent with the denormalised counters", async () => {
    const { placeBid, row, bids } = makeAuction()

    await placeBid("cus_1", 10_000_000)
    await placeBid("cus_2", 10_500_000)

    expect(row.bid_count).toBe(bids.length)
    expect(row.current_price).toBe(bids[bids.length - 1].amount)
    expect(row.last_sequence).toBe(bids.length)
  })
})

describe("racing at the close", () => {
  it("extends once per accepted bid inside the window", async () => {
    const { placeBid, row } = makeAuction({
      ends_at: new Date("2026-09-05T12:02:00Z"),
    })

    await placeBid("cus_1", 10_000_000, NOW)
    expect(row.ends_at.toISOString()).toBe("2026-09-05T12:05:00.000Z")

    // A second bid a minute later extends from THAT moment.
    const later = new Date("2026-09-05T12:01:00Z")
    await placeBid("cus_2", 10_500_000, later)
    expect(row.ends_at.toISOString()).toBe("2026-09-05T12:06:00.000Z")
  })

  it("rejects a bid that arrives after the clock ran out", async () => {
    const { placeBid } = makeAuction({
      ends_at: new Date("2026-09-05T11:59:00Z"),
    })

    const result = await placeBid("cus_1", 10_000_000, NOW)

    expect(result.ok).toBe(false)
    expect(result.error).toBe("ended")
  })

  it("does not lose an extension when a later bid is rejected", async () => {
    const { placeBid, row } = makeAuction({
      ends_at: new Date("2026-09-05T12:02:00Z"),
    })

    await placeBid("cus_1", 10_000_000, NOW)
    const extended = row.ends_at.toISOString()

    // Too low — rejected, and must not roll back the extension.
    await placeBid("cus_2", 10_100_000, NOW)

    expect(row.ends_at.toISOString()).toBe(extended)
  })
})

describe("closing exactly once", () => {
  // Models auction_result's unique index on auction_id: the second insert
  // is refused, so a retried job returns the first outcome.
  const makeCloser = () => {
    let result: { winner: string | null; amount: number | null } | null = null
    let closeRuns = 0

    const close = (
      bids: { id: string; bidder_id: string; amount: number; placed_at: Date; sequence: number }[],
      reserve: number | null
    ) => {
      closeRuns++
      if (result) return { alreadyClosed: true, result }

      const outcome = determineWinner(bids, reserve)
      result = {
        winner: outcome.winner?.bidder_id ?? null,
        amount: outcome.winner?.amount ?? null,
      }
      return { alreadyClosed: false, result }
    }

    return { close, runs: () => closeRuns, current: () => result }
  }

  const bids = [
    { id: "b1", bidder_id: "cus_1", amount: 12_000_000, placed_at: NOW, sequence: 1 },
    { id: "b2", bidder_id: "cus_2", amount: 14_000_000, placed_at: NOW, sequence: 2 },
  ]

  it("produces one winner when the job runs twice", () => {
    // §8.8 — "auction closing must be idempotent and safe if the closing job
    // retries."
    const { close, runs } = makeCloser()

    const first = close(bids, null)
    const second = close(bids, null)

    expect(first.alreadyClosed).toBe(false)
    expect(second.alreadyClosed).toBe(true)
    expect(second.result).toEqual(first.result)
    expect(runs()).toBe(2)
  })

  it("returns the same outcome even if bids changed between runs", () => {
    // A voided bid after closing must not silently re-decide the auction.
    const { close } = makeCloser()

    const first = close(bids, null)
    const second = close(
      [...bids, { id: "b3", bidder_id: "cus_3", amount: 20_000_000, placed_at: NOW, sequence: 3 }],
      null
    )

    expect(second.result).toEqual(first.result)
    expect(second.result?.winner).toBe("cus_2")
  })

  it("records no winner when the reserve was not met, and stays that way", () => {
    const { close } = makeCloser()

    const first = close(bids, 20_000_000)
    const second = close(bids, 20_000_000)

    expect(first.result?.winner).toBeNull()
    expect(second.alreadyClosed).toBe(true)
    expect(second.result?.winner).toBeNull()
  })
})
