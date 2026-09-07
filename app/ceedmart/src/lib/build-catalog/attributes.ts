import type { AttributeField } from "./schema"

// Coerce and validate component attributes against a category's schema.
//
// One implementation for two callers — the admin form and the CSV import —
// because a part typed in by hand and a part imported from a supplier sheet
// have to end up identical. If they diverge, the compatibility engine sees
// two shapes of the same thing and silently skips rules on one of them.
//
// Everything arrives as a string from a CSV and mostly as a string from a
// form, so coercion is the job: "750" becomes 750, "yes" becomes true,
// "ATX, mATX" becomes ["ATX","mATX"].

export type CoercionIssue = {
  key: string
  label: string
  message: string
  severity: "error" | "warning"
}

export type CoercionResult = {
  attributes: Record<string, unknown>
  issues: CoercionIssue[]
  ok: boolean
}

const TRUE = new Set(["true", "yes", "y", "1"])
const FALSE = new Set(["false", "no", "n", "0"])

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && !v.trim())

/**
 * Coerce a raw record into typed attributes.
 *
 * Unknown keys are DROPPED rather than passed through. A supplier sheet
 * carries columns we do not model, and letting them into `attributes` means
 * the next person reading the table cannot tell which keys the engine
 * actually uses.
 */
export const coerceAttributes = (
  fields: AttributeField[],
  raw: Record<string, unknown>
): CoercionResult => {
  const attributes: Record<string, unknown> = {}
  const issues: CoercionIssue[] = []

  const fail = (f: AttributeField, message: string) =>
    issues.push({ key: f.key, label: f.label, message, severity: "error" })

  for (const field of fields) {
    const value = raw[field.key]

    if (isBlank(value)) {
      if (field.required) {
        fail(field, `${field.label} is required`)
      } else if (field.usedByRules) {
        // Not an error — the engine skips a rule it lacks data for rather
        // than guessing (which is deliberate). But it means this part will
        // never be checked against that rule, and someone should know.
        issues.push({
          key: field.key,
          label: field.label,
          message: `${field.label} is empty, so compatibility checks using it will be skipped for this part`,
          severity: "warning",
        })
      }
      continue
    }

    const str = String(value).trim()

    switch (field.type) {
      case "number": {
        // Strip units a supplier sheet leaves in ("750 W"), but only after
        // confirming there is a digit to keep. Without that check "four"
        // strips to "" and Number("") is 0 — a garbage value silently
        // becoming a real one, which is how a 0-watt PSU reaches the
        // catalogue and quietly passes every headroom rule.
        const cleaned = str.replace(/[^\d.\-]/g, "")
        const n = Number(cleaned)
        if (!cleaned || !/\d/.test(cleaned) || !Number.isFinite(n)) {
          fail(field, `${field.label} must be a number, got "${str}"`)
          break
        }
        attributes[field.key] = n
        break
      }

      case "boolean": {
        const lower = str.toLowerCase()
        if (TRUE.has(lower)) attributes[field.key] = true
        else if (FALSE.has(lower)) attributes[field.key] = false
        else fail(field, `${field.label} must be yes or no, got "${str}"`)
        break
      }

      case "enum": {
        const allowed = field.options ?? []
        // Case-insensitive match, but store the schema's own casing so the
        // rules compare like with like.
        const match = allowed.find(
          (o) => o.toLowerCase() === str.toLowerCase()
        )
        if (!match) {
          fail(
            field,
            `${field.label} must be one of ${allowed.join(", ")}, got "${str}"`
          )
          break
        }
        attributes[field.key] = match
        break
      }

      case "list": {
        const items = str
          .split(/[,;|]/)
          .map((p) => p.trim())
          .filter(Boolean)
        if (!items.length) {
          fail(field, `${field.label} needs at least one value`)
          break
        }
        attributes[field.key] = items
        break
      }

      default:
        attributes[field.key] = str
    }
  }

  return {
    attributes,
    issues,
    ok: !issues.some((i) => i.severity === "error"),
  }
}

/** The CSV header a category expects, in schema order. */
export const csvHeader = (fields: AttributeField[]): string[] => [
  "label",
  "brand",
  "variant_id",
  "is_fixed",
  "model_family",
  ...fields.map((f) => (f.unit ? `${f.key} (${f.unit})` : f.key)),
]

/** Strip the "(unit)" suffix a header carries for readability. */
export const headerToKey = (header: string): string =>
  header.replace(/\s*\([^)]*\)\s*$/, "").trim()

/** A filled example row, so the downloaded template shows the shape rather
 *  than only the column names. */
export const csvExampleRow = (
  fields: AttributeField[],
  example: Record<string, string> = {}
): string[] => [
  example.label ?? "Example part",
  example.brand ?? "Brand",
  "",
  "no",
  "",
  ...fields.map((f) => {
    if (example[f.key] !== undefined) return example[f.key]
    if (f.type === "enum") return f.options?.[0] ?? ""
    if (f.type === "boolean") return "no"
    if (f.type === "number") return "0"
    if (f.type === "list") return ""
    return ""
  }),
]
