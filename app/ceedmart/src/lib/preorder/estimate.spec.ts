import {
  accumulatedPausedDays,
  addDays,
  deliversTo,
  estimateBreakdown,
  estimateDays,
  estimatedDeliveryDate,
  isOfferSellable,
  isOverdue,
  promisedDeliveryDate,
} from "./estimate"

describe("estimate legs", () => {
  it("sums the three configured legs", () => {
    expect(
      estimateDays({ procurement_days: 2, transit_days: 6, customs_days: 3 })
    ).toBe(11)
  })

  it("is settable per offer rather than a fixed fortnight", () => {
    // The whole point of D-01: a fast supplier is not averaged with a slow
    // one.
    const fast = estimateDays({
      procurement_days: 1,
      transit_days: 4,
      customs_days: 2,
    })
    const slow = estimateDays({
      procurement_days: 7,
      transit_days: 14,
      customs_days: 7,
    })

    expect(fast).toBe(7)
    expect(slow).toBe(28)
  })

  it("falls back to sensible defaults for unset legs", () => {
    expect(estimateDays({})).toBe(14)
    expect(estimateDays({ transit_days: 10 })).toBe(17)
  })

  it("ignores negative or non-numeric legs", () => {
    expect(estimateDays({ procurement_days: -5 })).toBe(14)
    expect(estimateDays({ transit_days: Number.NaN })).toBe(14)
  })

  it("rounds a fractional leg up", () => {
    expect(
      estimateDays({ procurement_days: 2.2, transit_days: 0, customs_days: 0 })
    ).toBe(3)
  })

  it("lets an override replace the summed legs", () => {
    const b = estimateBreakdown({
      procurement_days: 2,
      transit_days: 6,
      customs_days: 3,
      total_days_override: 20,
    })

    expect(b.totalDays).toBe(20)
    expect(b.isOverridden).toBe(true)
    // The legs are still reported, so admin can see what was overridden.
    expect(b.procurementDays).toBe(2)
  })

  it("ignores a zero or negative override", () => {
    expect(
      estimateDays({ procurement_days: 2, transit_days: 6, customs_days: 3, total_days_override: 0 })
    ).toBe(11)
  })
})

describe("dates", () => {
  it("projects an estimated delivery date in calendar days", () => {
    const from = new Date("2026-09-05T10:00:00Z")

    const eta = estimatedDeliveryDate(
      { procurement_days: 3, transit_days: 7, customs_days: 4 },
      from
    )

    expect(eta.toISOString().slice(0, 10)).toBe("2026-09-19")
  })

  it("starts the promised clock at sourcing confirmation, not payment", () => {
    // §6.2 — we cannot promise a window for an item we have not confirmed
    // is buyable.
    const paidAt = new Date("2026-09-01T10:00:00Z")
    const confirmedAt = new Date("2026-09-04T10:00:00Z")

    const promised = promisedDeliveryDate(
      { procurement_days: 3, transit_days: 7, customs_days: 4 },
      confirmedAt
    )

    expect(promised.getTime()).toBeGreaterThan(addDays(paidAt, 14).getTime())
    expect(promised.toISOString().slice(0, 10)).toBe("2026-09-18")
  })

  it("pushes the promise out by time spent waiting on the customer", () => {
    const confirmedAt = new Date("2026-09-04T10:00:00Z")

    const unpaused = promisedDeliveryDate({ total_days_override: 14 }, confirmedAt, 0)
    const paused = promisedDeliveryDate({ total_days_override: 14 }, confirmedAt, 3)

    expect(paused.toISOString().slice(0, 10)).toBe("2026-09-21")
    expect(unpaused.toISOString().slice(0, 10)).toBe("2026-09-18")
  })

  it("counts an open pause, rounding a partial day up", () => {
    // Rounding in our own favour is how a two-week promise quietly becomes
    // sixteen days.
    const pausedAt = new Date("2026-09-05T00:00:00Z")
    const now = new Date("2026-09-06T06:00:00Z")

    expect(accumulatedPausedDays(2, pausedAt, now)).toBe(4)
  })

  it("ignores a pause that has not started", () => {
    expect(accumulatedPausedDays(2, null)).toBe(2)
  })

  it("detects a missed promise", () => {
    const promised = new Date("2026-09-10T00:00:00Z")

    expect(isOverdue(promised, new Date("2026-09-09T00:00:00Z"))).toBe(false)
    expect(isOverdue(promised, new Date("2026-09-11T00:00:00Z"))).toBe(true)
    expect(isOverdue(null)).toBe(false)
  })
})

describe("offer sellability", () => {
  const now = new Date("2026-09-05T00:00:00Z")

  it("admits an active, verified, unexpired offer", () => {
    expect(
      isOfferSellable(
        {
          is_active: true,
          availability_verified_at: new Date("2026-09-04T00:00:00Z"),
          offer_expires_at: new Date("2026-10-01T00:00:00Z"),
        },
        { maxVerificationAgeDays: 7, now }
      ).sellable
    ).toBe(true)
  })

  it("refuses an inactive offer", () => {
    const r = isOfferSellable({ is_active: false }, { now })
    expect(r.sellable).toBe(false)
    expect(r.reason).toMatch(/not currently available/)
  })

  it("refuses an expired offer", () => {
    // §6.4 — an expired pre-order offer cannot be added to the cart.
    const r = isOfferSellable(
      { is_active: true, offer_expires_at: new Date("2026-09-01T00:00:00Z") },
      { now }
    )
    expect(r.sellable).toBe(false)
    expect(r.reason).toMatch(/expired/)
  })

  it("refuses an offer whose availability check has gone stale", () => {
    // Stale verification is the main reason a pre-order fails after payment.
    const r = isOfferSellable(
      {
        is_active: true,
        availability_verified_at: new Date("2026-08-01T00:00:00Z"),
      },
      { maxVerificationAgeDays: 7, now }
    )
    expect(r.sellable).toBe(false)
    expect(r.reason).toMatch(/availability check/)
  })

  it("refuses an offer never verified when verification is required", () => {
    const r = isOfferSellable(
      { is_active: true, availability_verified_at: null },
      { maxVerificationAgeDays: 7, now }
    )
    expect(r.sellable).toBe(false)
  })

  it("skips the freshness rule when no max age is configured", () => {
    expect(
      isOfferSellable({ is_active: true, availability_verified_at: null }, { now })
        .sellable
    ).toBe(true)
  })
})

describe("delivery coverage", () => {
  it("treats an empty list as nationwide", () => {
    expect(deliversTo([], "Lagos")).toBe(true)
    expect(deliversTo(null, "Lagos")).toBe(true)
  })

  it("matches a listed state case-insensitively", () => {
    expect(deliversTo(["Lagos", "Rivers"], "lagos")).toBe(true)
    expect(deliversTo(["Lagos", "Rivers"], "  RIVERS  ")).toBe(true)
  })

  it("refuses an unlisted state", () => {
    expect(deliversTo(["Lagos"], "Kano")).toBe(false)
    expect(deliversTo(["Lagos"], null)).toBe(false)
  })
})
