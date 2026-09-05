import { normaliseNigerianPhone } from "./eligibility"

describe("Nigerian phone normalisation", () => {
  it("accepts the forms people actually type", () => {
    for (const input of [
      "08012345678",
      "8012345678",
      "+2348012345678",
      "2348012345678",
      "234 801 234 5678",
      "0801-234-5678",
      "(0801) 234 5678",
    ]) {
      expect(normaliseNigerianPhone(input)).toBe("+2348012345678")
    }
  })

  it("accepts 7, 8 and 9 prefixes", () => {
    expect(normaliseNigerianPhone("07012345678")).toBe("+2347012345678")
    expect(normaliseNigerianPhone("09012345678")).toBe("+2349012345678")
  })

  it("rejects numbers that are the wrong length", () => {
    expect(normaliseNigerianPhone("0801234567")).toBeNull()
    expect(normaliseNigerianPhone("080123456789")).toBeNull()
  })

  it("rejects a landline or an implausible prefix", () => {
    expect(normaliseNigerianPhone("01234567890")).toBeNull()
    expect(normaliseNigerianPhone("06012345678")).toBeNull()
  })

  it("rejects empty and non-numeric input", () => {
    expect(normaliseNigerianPhone("")).toBeNull()
    expect(normaliseNigerianPhone("not a phone")).toBeNull()
  })

  it("is idempotent on an already-normalised number", () => {
    const once = normaliseNigerianPhone("08012345678")!
    expect(normaliseNigerianPhone(once)).toBe(once)
  })
})
