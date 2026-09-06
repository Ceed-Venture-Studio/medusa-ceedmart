import { coerceAttributes, csvHeader, headerToKey } from "./attributes"
import { CATEGORY_SCHEMAS, ruleCriticalKeys, schemaFor } from "./schema"
import { DEFAULT_COMPATIBILITY_RULES } from "./default-rules"

const fields = schemaFor("motherboard")

describe("attribute coercion", () => {
  it("turns CSV strings into the types the engine expects", () => {
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "ATX",
      supported_memory_types: "DDR5, DDR5-ECC",
      memory_slots: "4",
      max_memory_gb: "192",
      has_tpm: "yes",
    })

    expect(r.ok).toBe(true)
    expect(r.attributes).toMatchObject({
      socket: "AM5",
      form_factor: "ATX",
      supported_memory_types: ["DDR5", "DDR5-ECC"],
      memory_slots: 4,
      max_memory_gb: 192,
      has_tpm: true,
    })
  })

  it("strips units a supplier sheet leaves in a number", () => {
    const r = coerceAttributes(schemaFor("psu"), { wattage: "750 W" })
    expect(r.attributes.wattage).toBe(750)
  })

  it("normalises enum casing to the schema's own", () => {
    // The rules compare by value, so "atx" and "ATX" must not be two things.
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "atx",
      supported_memory_types: "DDR5",
      memory_slots: "4",
    })
    expect(r.attributes.form_factor).toBe("ATX")
  })

  it("rejects an enum value that is not in the list", () => {
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "SuperATX",
      supported_memory_types: "DDR5",
      memory_slots: "4",
    })
    expect(r.ok).toBe(false)
    expect(r.issues[0].message).toMatch(/must be one of/)
  })

  it("rejects a non-numeric number", () => {
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "ATX",
      supported_memory_types: "DDR5",
      memory_slots: "four",
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.key === "memory_slots")).toBe(true)
  })

  it("reports every missing required field, not just the first", () => {
    const r = coerceAttributes(fields, {})
    const required = fields.filter((f) => f.required).map((f) => f.key)
    for (const key of required) {
      expect(r.issues.some((i) => i.key === key && i.severity === "error")).toBe(true)
    }
  })

  it("warns — but does not fail — on an empty rule-critical optional field", () => {
    // The engine skips a rule it lacks data for rather than guessing, so
    // this is a gap worth flagging, not a rejection.
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "ATX",
      supported_memory_types: "DDR5",
      memory_slots: "4",
      // max_memory_gb omitted — optional but rule-critical
    })
    expect(r.ok).toBe(true)
    expect(
      r.issues.some((i) => i.key === "max_memory_gb" && i.severity === "warning")
    ).toBe(true)
  })

  it("drops columns the schema does not model", () => {
    // A supplier sheet carries plenty we don't use; letting it through
    // would hide which keys the engine actually reads.
    const r = coerceAttributes(fields, {
      socket: "AM5",
      form_factor: "ATX",
      supported_memory_types: "DDR5",
      memory_slots: "4",
      supplier_note: "clearance stock",
    })
    expect(r.attributes).not.toHaveProperty("supplier_note")
  })

  it("splits a list on commas, semicolons or pipes", () => {
    for (const raw of ["ATX, mATX", "ATX; mATX", "ATX|mATX"]) {
      const r = coerceAttributes(schemaFor("case"), {
        supported_form_factors: raw,
        max_gpu_length_mm: "360",
        max_cooler_height_mm: "170",
      })
      expect(r.attributes.supported_form_factors).toEqual(["ATX", "mATX"])
    }
  })

  it("accepts the boolean spellings people actually type", () => {
    for (const [raw, expected] of [["yes", true], ["Y", true], ["1", true],
                                   ["no", false], ["N", false], ["0", false]] as const) {
      const r = coerceAttributes(schemaFor("operating_system"), { requires_tpm: raw })
      expect(r.attributes.requires_tpm).toBe(expected)
    }
  })
})

describe("CSV headers", () => {
  it("annotates units for the person filling the sheet", () => {
    expect(csvHeader(schemaFor("psu"))).toContain("wattage (W)")
  })

  it("round-trips a unit-annotated header back to its key", () => {
    expect(headerToKey("max_gpu_length_mm (mm)")).toBe("max_gpu_length_mm")
    expect(headerToKey("socket")).toBe("socket")
  })

  it("always leads with the identity columns", () => {
    expect(csvHeader(schemaFor("cpu")).slice(0, 4)).toEqual([
      "label", "brand", "variant_id", "indicative_price_naira",
    ])
  })
})

describe("schema / rule contract", () => {
  it("declares every attribute the compatibility rules read", () => {
    // The rules reference attribute keys by name. A key no schema declares
    // is a rule that can never fire, which is worse than no rule — it looks
    // like coverage that isn't there.
    const declared = new Set(
      CATEGORY_SCHEMAS.flatMap((c) => c.fields.map((f) => `${c.code}.${f.key}`))
    )

    const missing: string[] = []
    for (const rule of DEFAULT_COMPATIBILITY_RULES) {
      for (const [cat, attr] of [
        [rule.left_category, rule.left_attribute],
        [rule.right_category, rule.right_attribute],
      ]) {
        if (!declared.has(`${cat}.${attr}`)) missing.push(`${rule.code}: ${cat}.${attr}`)
      }
    }

    expect(missing).toEqual([])
  })

  it("marks those keys as rule-critical so nobody deletes them blind", () => {
    for (const rule of DEFAULT_COMPATIBILITY_RULES) {
      expect(ruleCriticalKeys(rule.left_category)).toContain(rule.left_attribute)
      expect(ruleCriticalKeys(rule.right_category)).toContain(rule.right_attribute)
    }
  })

  it("covers both build types with slots", () => {
    const types = new Set(CATEGORY_SCHEMAS.flatMap((c) => c.buildTypes))
    expect([...types].sort()).toEqual(["desktop", "laptop"])
  })
})
