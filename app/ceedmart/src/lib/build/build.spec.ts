import {
  assertQuotable,
  canAcceptVersion,
  computeQuoteTotals,
  defaultValidUntil,
  generateReference,
} from "./quotes"
import {
  assertReadyForDispatch,
  assertResultRecordable,
  summarise,
  templateFor,
} from "./qa"

const line = (over: Partial<any> = {}) => ({
  label: "RTX 4070",
  quantity: 1,
  unit_price: 65_000_000,
  ...over,
})

describe("quote totals", () => {
  it("sums line items by quantity", () => {
    const t = computeQuoteTotals([
      line({ unit_price: 10_000_000, quantity: 2 }),
      line({ label: "RAM", unit_price: 5_000_000, quantity: 4 }),
    ])

    expect(t.subtotal).toBe(40_000_000)
    expect(t.total).toBe(40_000_000)
  })

  it("includes service items in the subtotal", () => {
    const t = computeQuoteTotals(
      [line({ unit_price: 10_000_000 })],
      [{ label: "Assembly & testing", quantity: 1, unit_price: 2_500_000 }]
    )

    expect(t.subtotal).toBe(12_500_000)
  })

  it("applies discount, tax and delivery in the right order", () => {
    const t = computeQuoteTotals([line({ unit_price: 100_000_000 })], [], {
      discount_total: 10_000_000,
      tax_total: 6_750_000,
      delivery_total: 500_000,
    })

    expect(t.total).toBe(97_250_000)
  })

  it("never discounts below zero", () => {
    const t = computeQuoteTotals([line({ unit_price: 1_000_000 })], [], {
      discount_total: 9_000_000,
    })

    expect(t.discount_total).toBe(1_000_000)
    expect(t.total).toBe(0)
  })

  it("ignores a negative quantity rather than crediting the customer", () => {
    const t = computeQuoteTotals([line({ quantity: -3, unit_price: 1_000_000 })])
    expect(t.subtotal).toBe(0)
  })
})

describe("quote validation", () => {
  it("rejects an empty quote", () => {
    expect(() => assertQuotable([])).toThrow(/at least one line item/)
  })

  it("rejects a line with no readable label", () => {
    expect(() => assertQuotable([line({ label: "  " })])).toThrow(/label/)
  })

  it("rejects a zero quantity", () => {
    expect(() => assertQuotable([line({ quantity: 0 })])).toThrow(/quantity/)
  })

  it("rejects a negative price", () => {
    expect(() => assertQuotable([line({ unit_price: -1 })])).toThrow(/negative/)
  })

  it("accepts a zero-priced line, which is how a freebie is quoted", () => {
    expect(() => assertQuotable([line({ unit_price: 0 })])).not.toThrow()
  })
})

describe("quote acceptance", () => {
  const now = new Date("2026-09-05T00:00:00Z")
  const sent = new Date("2026-09-01T00:00:00Z")
  const valid = new Date("2026-09-20T00:00:00Z")

  const quote = (over: Partial<any> = {}) => ({
    status: "sent",
    current_version_id: "v2",
    accepted_version_id: null,
    ...over,
  })
  const version = (over: Partial<any> = {}) => ({
    id: "v2",
    sent_at: sent,
    valid_until: valid,
    ...over,
  })

  it("accepts the latest sent, unexpired version", () => {
    expect(canAcceptVersion(quote(), version(), now).acceptable).toBe(true)
  })

  it("refuses a superseded version held in the customer's inbox", () => {
    // Rule 2 — only the LATEST valid quote can be accepted.
    const r = canAcceptVersion(quote(), version({ id: "v1" }), now)

    expect(r.acceptable).toBe(false)
    expect(r.failure).toBe("not_latest")
    expect(r.message).toMatch(/updated/)
  })

  it("refuses an expired version", () => {
    const r = canAcceptVersion(
      quote(),
      version({ valid_until: new Date("2026-09-04T00:00:00Z") }),
      now
    )

    expect(r.acceptable).toBe(false)
    expect(r.failure).toBe("expired")
  })

  it("refuses a draft that was never sent", () => {
    const r = canAcceptVersion(quote(), version({ sent_at: null }), now)

    expect(r.acceptable).toBe(false)
    expect(r.failure).toBe("not_sent")
  })

  it("refuses a second acceptance", () => {
    const r = canAcceptVersion(
      quote({ status: "accepted", accepted_version_id: "v2" }),
      version(),
      now
    )

    expect(r.acceptable).toBe(false)
    expect(r.failure).toBe("already_accepted")
  })

  it("refuses a rejected quote", () => {
    const r = canAcceptVersion(quote({ status: "rejected" }), version(), now)

    expect(r.acceptable).toBe(false)
    expect(r.failure).toBe("quote_closed")
  })

  it("gives each refusal its own message, so none looks like a bug", () => {
    const messages = new Set(
      [
        canAcceptVersion(quote(), version({ id: "v1" }), now),
        canAcceptVersion(quote(), version({ valid_until: sent }), now),
        canAcceptVersion(quote(), version({ sent_at: null }), now),
      ].map((r) => r.message)
    )

    expect(messages.size).toBe(3)
  })
})

describe("references", () => {
  it("excludes characters that are ambiguous read aloud", () => {
    // Support works the wrong record when "CB-I0O1" is misheard.
    for (let i = 0; i < 50; i++) {
      expect(generateReference("CB")).not.toMatch(/[01IO]/)
    }
  })

  it("is prefixed and readable", () => {
    expect(generateReference("CB")).toMatch(/^CB-[2-9A-HJ-NP-Z]{6}$/)
  })

  it("defaults validity to a short window", () => {
    const until = defaultValidUntil(new Date("2026-09-05T00:00:00Z"))
    expect(until.toISOString().slice(0, 10)).toBe("2026-09-19")
  })
})

describe("QA checklist", () => {
  const rows = (results: string[], required = true) =>
    results.map((result, i) => ({
      code: `c${i}`,
      label: `Check ${i}`,
      is_required: required,
      result,
    }))

  it("gives desktops and laptops different checks", () => {
    const desktop = templateFor("desktop").map((i) => i.code)
    const laptop = templateFor("laptop").map((i) => i.code)

    expect(desktop).toContain("gpu_output")
    expect(desktop).not.toContain("battery_health")
    expect(laptop).toContain("battery_health")
    expect(laptop).not.toContain("gpu_output")
  })

  it("shares the checks that apply to both", () => {
    expect(templateFor("desktop").map((i) => i.code)).toContain("thermals")
    expect(templateFor("laptop").map((i) => i.code)).toContain("thermals")
  })

  it("is complete only when every required check has passed", () => {
    expect(summarise(rows(["passed", "passed"])).complete).toBe(true)
    expect(summarise(rows(["passed", "pending"])).complete).toBe(false)
  })

  it("treats a FAILED required check as blocking, not merely recorded", () => {
    // The point is that the machine is fit to ship, not that the form is
    // filled in.
    const summary = summarise(rows(["passed", "failed"]))

    expect(summary.complete).toBe(false)
    expect(summary.failed).toBe(1)
  })

  it("lets an optional check stay unfinished", () => {
    const mixed = [
      { code: "a", label: "A", is_required: true, result: "passed" },
      { code: "b", label: "B", is_required: false, result: "pending" },
    ]

    expect(summarise(mixed).complete).toBe(true)
  })

  it("counts not_applicable as satisfied", () => {
    expect(summarise(rows(["passed", "not_applicable"])).complete).toBe(true)
  })

  it("treats an empty checklist as skipped, not passed", () => {
    expect(summarise([]).complete).toBe(false)
  })
})

describe("dispatch gate", () => {
  it("allows dispatch once QA is complete", () => {
    expect(() =>
      assertReadyForDispatch([
        { code: "a", label: "A", is_required: true, result: "passed" },
      ])
    ).not.toThrow()
  })

  it("blocks dispatch and names what is outstanding", () => {
    expect(() =>
      assertReadyForDispatch([
        { code: "a", label: "Thermals under load", is_required: true, result: "pending" },
      ])
    ).toThrow(/Thermals under load/)
  })

  it("blocks a build with no checklist at all", () => {
    expect(() => assertReadyForDispatch([])).toThrow(/no QA checklist/)
  })

  it("summarises rather than listing twenty outstanding checks", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      code: `c${i}`,
      label: `Check ${i}`,
      is_required: true,
      result: "pending",
    }))

    expect(() => assertReadyForDispatch(many)).toThrow(/and 4 more/)
  })
})

describe("recording a QA result", () => {
  it("accepts a pass with no note", () => {
    expect(() => assertResultRecordable("passed", null)).not.toThrow()
  })

  it("demands a note for a failure", () => {
    expect(() => assertResultRecordable("failed", null)).toThrow(/requires a note/)
    expect(() => assertResultRecordable("failed", "PSU fan rattles")).not.toThrow()
  })

  it("demands a note for not_applicable", () => {
    expect(() => assertResultRecordable("not_applicable", "  ")).toThrow(/requires a note/)
  })

  it("rejects an unknown result", () => {
    expect(() => assertResultRecordable("probably_fine", "x")).toThrow(/must be one of/)
  })
})
