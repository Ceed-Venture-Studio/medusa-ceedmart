import { parseCsv, toCsv } from "./csv"

describe("CSV parsing", () => {
  it("reads a simple sheet", () => {
    const { headers, rows } = parseCsv("label,socket\nRyzen 7,AM5\nCore i5,LGA1700")
    expect(headers).toEqual(["label", "socket"])
    expect(rows).toEqual([
      { label: "Ryzen 7", socket: "AM5" },
      { label: "Core i5", socket: "LGA1700" },
    ])
  })

  it("honours quoted fields containing commas", () => {
    // The one thing a naive split gets wrong, and exactly what a list
    // column looks like.
    const { rows } = parseCsv('label,supported_form_factors\nCase A,"ATX, mATX"')
    expect(rows[0].supported_form_factors).toBe("ATX, mATX")
  })

  it("handles escaped quotes", () => {
    const { rows } = parseCsv('label\n"24"" Monitor"')
    expect(rows[0].label).toBe('24" Monitor')
  })

  it("handles a quoted field spanning newlines", () => {
    const { rows } = parseCsv('label,help\nPart,"line one\nline two"')
    expect(rows).toHaveLength(1)
    expect(rows[0].help).toBe("line one\nline two")
  })

  it("strips the BOM Excel writes on Windows", () => {
    // Left in place it becomes part of the first header and every lookup
    // against "label" misses.
    const { headers } = parseCsv("﻿label,socket\nX,AM5")
    expect(headers[0]).toBe("label")
  })

  it("accepts CRLF line endings", () => {
    const { rows } = parseCsv("label,socket\r\nRyzen,AM5\r\n")
    expect(rows).toEqual([{ label: "Ryzen", socket: "AM5" }])
  })

  it("ignores blank lines", () => {
    const { rows } = parseCsv("label\nA\n\n\nB\n")
    expect(rows.map((r) => r.label)).toEqual(["A", "B"])
  })

  it("pads a short row rather than dropping the columns", () => {
    const { rows } = parseCsv("label,brand,socket\nOnly a name")
    expect(rows[0]).toEqual({ label: "Only a name", brand: "", socket: "" })
  })

  it("returns nothing for an empty file", () => {
    expect(parseCsv("").rows).toEqual([])
    expect(parseCsv("   \n  ").rows).toEqual([])
  })
})

describe("CSV writing", () => {
  it("quotes only what needs it", () => {
    expect(toCsv(["a", "b"], [["plain", "has,comma"]])).toBe('a,b\r\nplain,"has,comma"')
  })

  it("escapes embedded quotes", () => {
    expect(toCsv(["a"], [['24" monitor']])).toBe('a\r\n"24"" monitor"')
  })

  it("round-trips through the parser", () => {
    const csv = toCsv(["label", "list"], [["Case A", "ATX, mATX"]])
    expect(parseCsv(csv).rows[0]).toEqual({ label: "Case A", list: "ATX, mATX" })
  })
})
