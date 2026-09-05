import {
  computeLandedCost,
  inclusionSummary,
  marginOn,
  priceDrift,
  snapshotOffer,
} from "./pricing"

// A ₦300,000-ish laptop: $200.00 source (20000 cents) at ₦1,600/$ plus
// freight, duty and margin. All naira figures are kobo.
const components = {
  source_price: 20_000,
  source_currency: "usd",
  fx_rate: 1_600,
  freight: 2_500_000,
  insurance: 500_000,
  duty: 4_000_000,
  clearing: 1_000_000,
  local_delivery: 800_000,
  margin: 5_000_000,
  contingency: 1_000_000,
}

describe("landed cost", () => {
  it("converts the source price at the recorded rate", () => {
    // 20000 cents × 1600 = 32,000,000 kobo = ₦320,000
    expect(computeLandedCost(components).sourceCostNgn).toBe(32_000_000)
  })

  it("sums freight, insurance, duty, clearing and local delivery", () => {
    expect(computeLandedCost(components).landedAddOns).toBe(8_800_000)
  })

  it("keeps margin and contingency separate from true cost", () => {
    expect(computeLandedCost(components).uplift).toBe(6_000_000)
  })

  it("totals every component", () => {
    expect(computeLandedCost(components).total).toBe(46_800_000)
  })

  it("returns zero source cost when no FX rate was captured", () => {
    // Better than silently pricing at the dollar figure.
    expect(
      computeLandedCost({ source_price: 20_000, fx_rate: 0 }).sourceCostNgn
    ).toBe(0)
  })

  it("ignores negative components", () => {
    expect(computeLandedCost({ freight: -5000 }).landedAddOns).toBe(0)
  })

  it("treats missing components as zero", () => {
    expect(computeLandedCost({}).total).toBe(0)
  })
})

describe("margin", () => {
  it("measures the locked price against true cost", () => {
    // Locked at ₦468,000 against ₦408,000 of real cost.
    const m = marginOn(46_800_000, components)

    expect(m.amount).toBe(6_000_000)
    expect(m.rate).toBeCloseTo(0.1282, 3)
  })

  it("reports a negative margin when the price sits below cost", () => {
    const m = marginOn(30_000_000, components)

    expect(m.amount).toBeLessThan(0)
  })
})

describe("price drift", () => {
  it("is zero when the locked price still matches its components", () => {
    expect(priceDrift(46_800_000, components).deltaKobo).toBe(0)
  })

  it("flags an offer left behind by an FX move", () => {
    // The rate moved to ₦1,750/$ but nobody re-locked the price.
    const moved = { ...components, fx_rate: 1_750 }
    const drift = priceDrift(46_800_000, moved)

    expect(drift.deltaKobo).toBe(3_000_000)
    expect(drift.suggested).toBe(49_800_000)
    expect(drift.deltaRate).toBeGreaterThan(0)
  })

  it("does not itself change the customer-facing price", () => {
    // The locked price is authoritative; drift only flags offers worth
    // re-locking, so §5.3's guarantee survives an FX move.
    const moved = { ...components, fx_rate: 1_750 }
    const snapshot = snapshotOffer(
      { locked_price: 46_800_000, cost_components: moved, currency_code: "ngn" },
      1
    )

    expect(snapshot.unit_price).toBe(46_800_000)
  })
})

describe("inclusion summary", () => {
  it("lists everything an all-inclusive offer covers", () => {
    const s = inclusionSummary({})

    expect(s.included).toEqual([
      "Import duty",
      "Customs clearing",
      "Delivery within Nigeria",
    ])
    expect(s.excluded).toEqual([])
  })

  it("names what the customer will still be billed for", () => {
    // The real anxiety with an imported purchase is the bill that arrives
    // later, so exclusions have to be explicit.
    const s = inclusionSummary({ includes_local_delivery: false })

    expect(s.excluded).toEqual(["Delivery within Nigeria"])
    expect(s.included).toContain("Import duty")
  })
})

describe("offer snapshot", () => {
  it("freezes price, FX and item facts onto the order", () => {
    const snapshot = snapshotOffer(
      {
        locked_price: 46_800_000,
        currency_code: "ngn",
        cost_components: components,
        fx_rate: 1_600,
        condition: "new",
        warranty_text: "12 months Ceedmart warranty",
        return_policy_text: "7-day return",
      },
      2
    )

    expect(snapshot).toMatchObject({
      unit_price: 46_800_000,
      currency_code: "ngn",
      fx_rate: 1_600,
      quantity: 2,
      condition: "new",
      warranty_text: "12 months Ceedmart warranty",
    })
    expect(snapshot.cost_snapshot).toEqual(components)
  })
})
