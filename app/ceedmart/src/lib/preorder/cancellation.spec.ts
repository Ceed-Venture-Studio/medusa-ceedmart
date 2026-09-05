import {
  automaticRefundAmount,
  canSelfCancel,
  cancellationNotice,
  cancellationWindow,
  isValidReasonCode,
  owesFullRefund,
} from "./cancellation"

describe("cancellation window", () => {
  it("is free before Ceedmart has committed money to a supplier", () => {
    for (const status of [
      "paid",
      "availability_check",
      "sourcing_confirmed",
    ]) {
      expect(cancellationWindow(status)).toBe("free")
      expect(canSelfCancel(status)).toBe(true)
    }
  })

  it("closes at supplier purchase — the D-03 cutoff", () => {
    expect(cancellationWindow("purchased")).toBe("restricted")
    expect(canSelfCancel("purchased")).toBe(false)
  })

  it("stays restricted through transit and customs", () => {
    for (const status of [
      "at_us_facility",
      "in_international_transit",
      "customs_clearance",
      "out_for_delivery",
    ]) {
      expect(cancellationWindow(status)).toBe("restricted")
    }
  })

  it("is closed once nothing is left to cancel", () => {
    for (const status of ["delivered", "refunded", "cancelled"]) {
      expect(cancellationWindow(status)).toBe("closed")
      expect(canSelfCancel(status)).toBe(false)
    }
  })
})

describe("customer-facing notice", () => {
  it("promises a full refund before commitment", () => {
    expect(cancellationNotice("paid")).toMatch(/full refund/)
  })

  it("does not promise a refund after commitment", () => {
    const notice = cancellationNotice("purchased")
    expect(notice).not.toMatch(/full refund/)
    expect(notice).toMatch(/contact support/i)
  })

  it("says plainly when cancellation is over", () => {
    expect(cancellationNotice("delivered")).toMatch(/no longer be cancelled/)
  })
})

describe("automatic refund", () => {
  it("makes the customer whole before commitment", () => {
    expect(automaticRefundAmount("paid", 46_800_000)).toBe(46_800_000)
  })

  it("refuses to guess after commitment", () => {
    // A wrong automatic number is worse than no number.
    expect(automaticRefundAmount("purchased", 46_800_000)).toBeNull()
  })

  it("never returns a negative amount", () => {
    expect(automaticRefundAmount("paid", -100)).toBe(0)
  })
})

describe("reason codes", () => {
  it("validates known codes", () => {
    expect(isValidReasonCode("unable_to_source")).toBe(true)
    expect(isValidReasonCode("because_i_said_so")).toBe(false)
  })

  it("owes a full refund whenever the failure is ours", () => {
    // The cutoff does not apply when we are the reason it failed.
    for (const reason of [
      "unable_to_source",
      "price_increase_rejected",
      "substitution_rejected",
      "delivery_failed",
      "item_damaged",
    ] as const) {
      expect(owesFullRefund(reason)).toBe(true)
    }
  })

  it("leaves a change of mind to the cancellation window", () => {
    expect(owesFullRefund("customer_changed_mind")).toBe(false)
  })
})
