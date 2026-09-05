import {
  applyAntiSnipe,
  checkBid,
  determineWinner,
  maskBidder,
  minimumNextBid,
  rankedFallbackBidders,
  type AuctionState,
  type BidRow,
} from "./rules"

const NOW = new Date("2026-09-05T12:00:00Z")

const auction = (over: Partial<AuctionState> = {}): AuctionState => ({
  status: "live",
  starts_at: new Date("2026-09-05T10:00:00Z"),
  ends_at: new Date("2026-09-05T18:00:00Z"),
  starting_price: 10_000_000,
  min_increment: 500_000,
  current_price: null,
  buy_now_price: null,
  leading_bidder_id: null,
  antisnipe_window_seconds: 300,
  antisnipe_extension_seconds: 300,
  ...over,
})

const bid = (over: Partial<BidRow> = {}): BidRow => ({
  id: "bid_1",
  bidder_id: "cus_1",
  amount: 10_000_000,
  placed_at: NOW,
  sequence: 1,
  ...over,
})

describe("minimum next bid", () => {
  it("is the starting price when nobody has bid", () => {
    expect(minimumNextBid(auction())).toBe(10_000_000)
  })

  it("clears the current price by one increment", () => {
    expect(
      minimumNextBid(auction({ current_price: 10_000_000 }))
    ).toBe(10_500_000)
  })
})

describe("bid acceptance", () => {
  it("accepts a first bid at the starting price", () => {
    expect(checkBid(auction(), { amount: 10_000_000, bidderId: "cus_1" }, NOW).ok).toBe(true)
  })

  it("rejects a bid below the minimum and names the minimum", () => {
    // §8.11 — "a bid below the minimum is rejected with the new minimum
    // displayed."
    const r = checkBid(
      auction({ current_price: 10_000_000 }),
      { amount: 10_200_000, bidderId: "cus_2" },
      NOW
    )

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe("below_minimum")
    expect(r.minimum).toBe(10_500_000)
    expect(r.message).toContain("10500000")
  })

  it("accepts a bid exactly at the minimum", () => {
    expect(
      checkBid(
        auction({ current_price: 10_000_000 }),
        { amount: 10_500_000, bidderId: "cus_2" },
        NOW
      ).ok
    ).toBe(true)
  })

  it("refuses to let a bidder outbid themselves", () => {
    // §8.6 — no bidding against yourself to raise your own leading price.
    const r = checkBid(
      auction({ current_price: 10_000_000, leading_bidder_id: "cus_1" }),
      { amount: 11_000_000, bidderId: "cus_1" },
      NOW
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("self_outbid")
  })

  it("rejects a bid after the clock ran out, however it looked to the bidder", () => {
    // §8.8 — server time is authoritative.
    const r = checkBid(
      auction({ ends_at: new Date("2026-09-05T11:59:59Z") }),
      { amount: 20_000_000, bidderId: "cus_2" },
      NOW
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("ended")
  })

  it("rejects a bid before the auction opens", () => {
    const r = checkBid(
      auction({ status: "scheduled", starts_at: new Date("2026-09-06T10:00:00Z") }),
      { amount: 20_000_000, bidderId: "cus_2" },
      NOW
    )

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("not_started")
  })

  it("rejects a zero or negative amount", () => {
    for (const amount of [0, -1]) {
      const r = checkBid(auction(), { amount, bidderId: "cus_1" }, NOW)
      expect(r.ok).toBe(false)
    }
  })

  it("requires Buy Now to be the exact price", () => {
    const a = auction({ buy_now_price: 30_000_000 })

    expect(
      checkBid(a, { amount: 30_000_000, bidderId: "cus_1", kind: "buy_now" }, NOW).ok
    ).toBe(true)
    expect(
      checkBid(a, { amount: 29_000_000, bidderId: "cus_1", kind: "buy_now" }, NOW).ok
    ).toBe(false)
  })

  it("refuses Buy Now when the auction has no Buy Now price", () => {
    const r = checkBid(
      auction(),
      { amount: 30_000_000, bidderId: "cus_1", kind: "buy_now" },
      NOW
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("no_buy_now")
  })
})

describe("anti-sniping", () => {
  const closing = (endsAt: string) =>
    applyAntiSnipe(
      {
        ends_at: new Date(endsAt),
        antisnipe_window_seconds: 300,
        antisnipe_extension_seconds: 300,
      },
      NOW
    )

  it("does not extend a bid outside the closing window", () => {
    // Ten minutes left, five-minute window.
    const r = closing("2026-09-05T12:10:00Z")
    expect(r.extended).toBe(false)
    expect(r.ends_at.toISOString()).toBe("2026-09-05T12:10:00.000Z")
  })

  it("extends a bid inside the closing window", () => {
    // D-11 — extend by five minutes when a bid arrives in the final five.
    const r = closing("2026-09-05T12:04:00Z")
    expect(r.extended).toBe(true)
    expect(r.ends_at.toISOString()).toBe("2026-09-05T12:05:00.000Z")
  })

  it("measures the extension from now, so a last-second bid buys the full window", () => {
    // This is what actually defeats sniping: bidding with one second left
    // gives everyone else the full five minutes, not one more second.
    const r = closing("2026-09-05T12:00:01Z")
    expect(r.ends_at.toISOString()).toBe("2026-09-05T12:05:00.000Z")
  })

  it("extends on the window boundary", () => {
    const r = closing("2026-09-05T12:05:00Z")
    expect(r.extended).toBe(true)
  })

  it("does not extend for Buy Now, which ends the auction", () => {
    const r = applyAntiSnipe(
      {
        ends_at: new Date("2026-09-05T12:01:00Z"),
        antisnipe_window_seconds: 300,
        antisnipe_extension_seconds: 300,
      },
      NOW,
      "buy_now"
    )
    expect(r.extended).toBe(false)
  })

  it("is disabled when either setting is zero", () => {
    expect(
      applyAntiSnipe(
        {
          ends_at: new Date("2026-09-05T12:01:00Z"),
          antisnipe_window_seconds: 0,
          antisnipe_extension_seconds: 300,
        },
        NOW
      ).extended
    ).toBe(false)
  })
})

describe("winner determination", () => {
  it("picks the highest bid", () => {
    const r = determineWinner(
      [
        bid({ id: "b1", amount: 10_000_000, sequence: 1 }),
        bid({ id: "b2", amount: 12_000_000, sequence: 2, bidder_id: "cus_2" }),
      ],
      null
    )

    expect(r.winner?.id).toBe("b2")
    expect(r.reserveMet).toBe(true)
  })

  it("selects NO winner when the reserve is not met", () => {
    // §8.8 — not the highest bidder by default.
    const r = determineWinner([bid({ amount: 10_000_000 })], 15_000_000)

    expect(r.winner).toBeNull()
    expect(r.reserveMet).toBe(false)
    // The highest bid is still reported, for the admin view.
    expect(r.highest?.amount).toBe(10_000_000)
  })

  it("treats a bid exactly at the reserve as meeting it", () => {
    const r = determineWinner([bid({ amount: 15_000_000 })], 15_000_000)
    expect(r.winner).not.toBeNull()
  })

  it("breaks an equal-value tie on the earliest server timestamp", () => {
    // §8.8 — "if equal-value bids are possible, the earliest accepted
    // server timestamp wins."
    const r = determineWinner(
      [
        bid({
          id: "late",
          amount: 12_000_000,
          placed_at: new Date("2026-09-05T12:00:05Z"),
          sequence: 2,
        }),
        bid({
          id: "early",
          amount: 12_000_000,
          placed_at: new Date("2026-09-05T12:00:01Z"),
          sequence: 1,
          bidder_id: "cus_2",
        }),
      ],
      null
    )

    expect(r.winner?.id).toBe("early")
  })

  it("falls back to the lower sequence when timestamps are identical", () => {
    const same = new Date("2026-09-05T12:00:00Z")
    const r = determineWinner(
      [
        bid({ id: "second", amount: 12_000_000, placed_at: same, sequence: 9 }),
        bid({ id: "first", amount: 12_000_000, placed_at: same, sequence: 4 }),
      ],
      null
    )

    expect(r.winner?.id).toBe("first")
  })

  it("excludes voided bids from winning", () => {
    const r = determineWinner(
      [
        bid({ id: "voided", amount: 20_000_000, voided_at: NOW }),
        bid({ id: "valid", amount: 12_000_000, bidder_id: "cus_2", sequence: 2 }),
      ],
      null
    )

    expect(r.winner?.id).toBe("valid")
  })

  it("selects no winner when every bid was voided", () => {
    expect(determineWinner([bid({ voided_at: NOW })], null).winner).toBeNull()
  })

  it("selects no winner when nobody bid", () => {
    expect(determineWinner([], null).winner).toBeNull()
  })
})

describe("fallback bidders after a default", () => {
  const bids = [
    bid({ id: "b1", bidder_id: "cus_1", amount: 15_000_000, sequence: 1 }),
    bid({ id: "b2", bidder_id: "cus_2", amount: 14_000_000, sequence: 2 }),
    bid({ id: "b3", bidder_id: "cus_2", amount: 12_000_000, sequence: 3 }),
    bid({ id: "b4", bidder_id: "cus_3", amount: 13_000_000, sequence: 4 }),
  ]

  it("ranks the next bidders best first, excluding the defaulter", () => {
    const ranked = rankedFallbackBidders(bids, ["cus_1"])

    expect(ranked.map((b) => b.bidder_id)).toEqual(["cus_2", "cus_3"])
  })

  it("offers each bidder their own HIGHEST bid, not an earlier lower one", () => {
    // Offering someone a worse deal than they already made is not an offer.
    const ranked = rankedFallbackBidders(bids, ["cus_1"])

    expect(ranked[0].amount).toBe(14_000_000)
  })

  it("skips bidders below the reserve", () => {
    const ranked = rankedFallbackBidders(bids, ["cus_1"], 13_500_000)

    expect(ranked.map((b) => b.bidder_id)).toEqual(["cus_2"])
  })

  it("returns nobody when everyone is excluded", () => {
    expect(rankedFallbackBidders(bids, ["cus_1", "cus_2", "cus_3"])).toEqual([])
  })

  it("ignores voided bids", () => {
    const ranked = rankedFallbackBidders(
      [bid({ bidder_id: "cus_2", amount: 20_000_000, voided_at: NOW })],
      []
    )
    expect(ranked).toEqual([])
  })
})

describe("bidder masking", () => {
  it("shows only the last four digits", () => {
    // §8.6 — "Bidder ••••4821".
    expect(maskBidder("cus_01HXYZ4821")).toBe("Bidder ••••4821")
  })

  it("is stable for the same bidder", () => {
    expect(maskBidder("cus_abcdef")).toBe(maskBidder("cus_abcdef"))
  })

  it("never leaks the raw identifier when it has no digits", () => {
    const masked = maskBidder("cus_abcdef")
    expect(masked).toMatch(/^Bidder ••••\d{4}$/)
    expect(masked).not.toContain("abcdef")
  })

  it("distinguishes different bidders", () => {
    expect(maskBidder("cus_aaa")).not.toBe(maskBidder("cus_bbb"))
  })
})
