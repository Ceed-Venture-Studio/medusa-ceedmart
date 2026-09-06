// Minimal CSV parsing for the component bulk import.
//
// Hand-rolled rather than pulling a dependency: the input is a sheet
// exported from Excel or Google Sheets, and the only thing those do that a
// naive split cannot handle is quoted fields containing commas or newlines
// — which is exactly what this handles and nothing more.

export type CsvRow = Record<string, string>

/** Parse CSV text into header + rows, honouring RFC-4180 quoting. */
export const parseCsv = (text: string): { headers: string[]; rows: CsvRow[] } => {
  // Excel on Windows writes a BOM; left in place it becomes part of the
  // first header and every lookup against it misses.
  const input = text.replace(/^﻿/, "")

  const records: string[][] = []
  let field = ""
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is an escaped quote.
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      record.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      // Swallow the \n of a \r\n pair.
      if (char === "\r" && input[i + 1] === "\n") i++
      record.push(field)
      field = ""
      records.push(record)
      record = []
    } else {
      field += char
    }
  }

  // Whatever is left when the input ends.
  if (field.length || record.length) {
    record.push(field)
    records.push(record)
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim()))
  if (!nonEmpty.length) return { headers: [], rows: [] }

  const headers = nonEmpty[0].map((h) => h.trim())
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: CsvRow = {}
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim()
    })
    return row
  })

  return { headers, rows }
}

/** Serialise rows to CSV, quoting only where it is needed. */
export const toCsv = (headers: string[], rows: string[][]): string => {
  const cell = (v: string) =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")
}
