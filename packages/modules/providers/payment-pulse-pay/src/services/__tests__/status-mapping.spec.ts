import { PulsePaymentStatus, mapPulseStatus } from "../pulse-pay"

// These numbers came from PulsePaymentCore.Domain/Enums/PaymentStatus.cs and
// were confirmed against a live payment. The original mapping read them as if
// they were PayoutStatus — a different enum in the same API where 1=Pending
// and 2=Success — and got eight of the nine wrong, including reporting a
// COMPLETED payment as "canceled".
//
// Nothing in a type checker can catch that: both enums are plain integers, so
// the wrong one compiles perfectly. Only a table like this does, which is why
// every value is pinned rather than the interesting few.

describe("mapPulseStatus", () => {
  describe("the numeric enum", () => {
    const cases: [PulsePaymentStatus, string, string][] = [
      [PulsePaymentStatus.Initiated, "pending", "created, not yet submitted"],
      [PulsePaymentStatus.Authorized, "authorized", "a hold, not money taken"],
      [PulsePaymentStatus.Pending, "pending", "in flight"],
      [PulsePaymentStatus.Completed, "captured", "the only status that means paid"],
      [PulsePaymentStatus.Failed, "error", "failed at the gateway"],
      [PulsePaymentStatus.Cancelled, "canceled", "cancelled or abandoned"],
      [PulsePaymentStatus.Refunded, "captured", "captured then returned"],
      [PulsePaymentStatus.ChargedBack, "error", "disputed reversal, needs a human"],
      [PulsePaymentStatus.Expired, "canceled", "cancelled by the clock"],
    ]

    it.each(cases)("%d → %s (%s)", (status, expected) => {
      expect(mapPulseStatus(status)).toBe(expected)
    })

    it("covers every value the enum defines", () => {
      const defined = Object.values(PulsePaymentStatus).filter(
        (v) => typeof v === "number"
      )
      expect(cases.map(([s]) => s).sort()).toEqual(defined.sort())
    })
  })

  describe("the string forms used in webhooks", () => {
    it.each([
      ["completed", "captured"],
      ["success", "captured"],
      ["successful", "captured"],
      ["authorized", "authorized"],
      ["pending", "pending"],
      ["initiated", "pending"],
      ["failed", "error"],
      ["cancelled", "canceled"],
      ["canceled", "canceled"],
      ["expired", "canceled"],
      ["refunded", "captured"],
      ["charged_back", "error"],
    ])("%s → %s", (input, expected) => {
      expect(mapPulseStatus(input)).toBe(expected)
    })

    it("is case- and whitespace-insensitive, because webhooks are not tidy", () => {
      expect(mapPulseStatus("  SUCCESS  ")).toBe("captured")
      expect(mapPulseStatus("Failed")).toBe("error")
    })

    // Paystack's word for "initialized but not yet paid". Pulse writes it onto
    // a payment the moment anything READS that payment, so it arrives on
    // sessions the customer is still in the middle of paying. It maps to
    // canceled because that is what Pulse has recorded — the real protection
    // is not polling a live session, not a lenient mapping here.
    it("treats abandoned as cancelled", () => {
      expect(mapPulseStatus("abandoned")).toBe("canceled")
    })
  })

  describe("values we do not recognise", () => {
    // Pending is the only answer that neither takes money nor abandons an
    // order, so it is the one safe response to a status we cannot read.
    it.each([[99], [-1], ["something-new"], [null], [undefined], [""], [{}]])(
      "%p → pending",
      (input) => {
        expect(mapPulseStatus(input)).toBe("pending")
      }
    )
  })

  // The specific regression. Worth its own test so a future edit that
  // reintroduces it fails by name rather than as one row in a table.
  it("never reports a completed payment as canceled", () => {
    expect(mapPulseStatus(PulsePaymentStatus.Completed)).not.toBe("canceled")
    expect(mapPulseStatus(PulsePaymentStatus.Completed)).toBe("captured")
  })

  it("never reports an authorization as captured", () => {
    expect(mapPulseStatus(PulsePaymentStatus.Authorized)).toBe("authorized")
  })
})
