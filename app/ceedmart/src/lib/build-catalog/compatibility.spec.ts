import { canSubmit, estimateTotal, evaluate, type Pick } from "./compatibility"
import { DEFAULT_COMPATIBILITY_RULES } from "./default-rules"

const pick = (
  category: string,
  attributes: Record<string, unknown>,
  over: Partial<Pick> = {}
): Pick => ({
  category_code: category,
  option_id: `${category}_1`,
  label: category,
  quantity: 1,
  attributes,
  ...over,
})

const rules = DEFAULT_COMPATIBILITY_RULES

describe("socket and fit rules", () => {
  it("blocks a CPU and motherboard with different sockets", () => {
    const r = evaluate(
      [
        pick("cpu", { socket: "AM5" }),
        pick("motherboard", { socket: "LGA1700" }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("cpu_socket")
    expect(r.submittable).toBe(false)
  })

  it("passes a matching socket, ignoring case", () => {
    const r = evaluate(
      [pick("cpu", { socket: "am5" }), pick("motherboard", { socket: "AM5" })],
      rules
    )

    expect(r.blocking).toHaveLength(0)
  })

  it("explains the failure in words a first-time builder understands", () => {
    const r = evaluate(
      [pick("cpu", { socket: "AM5" }), pick("motherboard", { socket: "LGA1700" })],
      rules
    )
    const finding = r.blocking.find((f) => f.code === "cpu_socket")!

    // §7.10 — the system explains every blocking failure.
    expect(finding.message).not.toMatch(/[A-Z_]{6,}/)
    expect(finding.message).toMatch(/doesn't fit/)
    expect(finding.remedy).toBeTruthy()
  })

  it("blocks a motherboard that won't fit the case", () => {
    const r = evaluate(
      [
        pick("motherboard", { form_factor: "ATX" }),
        pick("case", { supported_form_factors: ["Mini-ITX", "mATX"] }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("case_form_factor")
  })

  it("blocks a GPU longer than the case allows", () => {
    const r = evaluate(
      [
        pick("gpu", { length_mm: 336 }),
        pick("case", { max_gpu_length_mm: 300 }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("gpu_clearance")
  })

  it("allows a GPU that exactly fits", () => {
    const r = evaluate(
      [
        pick("gpu", { length_mm: 300 }),
        pick("case", { max_gpu_length_mm: 300 }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).not.toContain("gpu_clearance")
  })

  it("accepts a cooler that lists the CPU's socket among several", () => {
    // A cooler supporting ["AM5","LGA1700"] fits an AM5 processor. Requiring
    // EVERY listed socket to match one CPU blocked every multi-socket cooler
    // against every processor — found by driving the configurator, not by
    // any unit test, because the seeded fixture had a single-socket cooler.
    const r = evaluate(
      [
        pick("cpu_cooler", { sockets: ["AM5", "LGA1700"] }),
        pick("cpu", { socket: "AM5" }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).not.toContain("cooler_socket")
  })

  it("still blocks a multi-socket cooler that lacks the CPU's socket", () => {
    const r = evaluate(
      [
        pick("cpu_cooler", { sockets: ["AM4", "LGA1200"] }),
        pick("cpu", { socket: "AM5" }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("cooler_socket")
  })

  it("blocks a cooler with no bracket for the CPU socket", () => {
    const r = evaluate(
      [
        pick("cpu_cooler", { sockets: "AM4" }),
        pick("cpu", { socket: "AM5" }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("cooler_socket")
  })
})

describe("memory rules", () => {
  it("blocks the wrong memory type", () => {
    const r = evaluate(
      [
        pick("memory", { memory_type: "DDR4" }),
        pick("motherboard", { supported_memory_types: ["DDR5"] }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("memory_type")
  })

  it("blocks more sticks than the board has slots", () => {
    const r = evaluate(
      [
        pick("memory", { sticks: 1, memory_type: "DDR5" }, { quantity: 6 }),
        pick("motherboard", {
          memory_slots: 4,
          supported_memory_types: ["DDR5"],
        }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("memory_slots")
  })

  it("blocks more total capacity than the board can address", () => {
    const r = evaluate(
      [
        pick("memory", { capacity_gb: 64, memory_type: "DDR5" }, { quantity: 4 }),
        pick("motherboard", {
          max_memory_gb: 128,
          supported_memory_types: ["DDR5"],
          memory_slots: 4,
        }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("memory_capacity")
  })

  it("only warns about memory faster than the board supports", () => {
    // It runs, just slower than its rating — a recommendation, not a block.
    const r = evaluate(
      [
        pick("memory", { speed_mhz: 6400, memory_type: "DDR5" }),
        pick("motherboard", {
          max_memory_speed_mhz: 5600,
          supported_memory_types: ["DDR5"],
        }),
      ],
      rules
    )

    expect(r.warnings.map((f) => f.code)).toContain("memory_speed")
    expect(r.blocking.map((f) => f.code)).not.toContain("memory_speed")
  })
})

describe("power rules", () => {
  it("blocks a PSU below the card's requirement", () => {
    const r = evaluate(
      [
        pick("psu", { wattage: 450 }),
        pick("gpu", { recommended_psu_watts: 750 }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).toContain("psu_headroom")
  })

  it("warns when the PSU meets the requirement but has no headroom", () => {
    const r = evaluate(
      [
        pick("psu", { wattage: 750 }),
        pick("gpu", { recommended_psu_watts: 750 }),
      ],
      rules
    )

    expect(r.blocking.map((f) => f.code)).not.toContain("psu_headroom")
    expect(r.warnings.map((f) => f.code)).toContain("psu_margin")
  })

  it("is quiet when the PSU has comfortable headroom", () => {
    const r = evaluate(
      [
        pick("psu", { wattage: 1000 }),
        pick("gpu", { recommended_psu_watts: 750 }),
      ],
      rules
    )

    expect(r.warnings.map((f) => f.code)).not.toContain("psu_margin")
  })
})

describe("missing data", () => {
  it("stays quiet rather than guessing when an attribute is absent", () => {
    // Telling a customer their parts clash because we lack data about them
    // is worse than saying nothing — a specialist reviews every build.
    const r = evaluate(
      [pick("cpu", {}), pick("motherboard", { socket: "AM5" })],
      rules
    )

    expect(r.blocking).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
  })

  it("stays quiet when only one side of a rule is chosen", () => {
    const r = evaluate([pick("cpu", { socket: "AM5" })], rules)
    expect(r.blocking).toHaveLength(0)
  })

  it("reports one finding per rule, not one per part", () => {
    const r = evaluate(
      [
        pick("storage", { interface: "SATA" }, { option_id: "s1" }),
        pick("storage", { interface: "SATA" }, { option_id: "s2" }),
        pick("storage", { interface: "SATA" }, { option_id: "s3" }),
        pick("motherboard", { supported_storage_interfaces: ["NVMe"] }),
      ],
      rules
    )

    expect(
      r.blocking.filter((f) => f.code === "storage_interface")
    ).toHaveLength(1)
  })
})

describe("required slots", () => {
  it("is not submittable while a required slot is empty", () => {
    const r = evaluate([pick("cpu", { socket: "AM5" })], rules, [
      "cpu",
      "motherboard",
      "memory",
    ])

    expect(r.missing).toEqual(["motherboard", "memory"])
    expect(r.submittable).toBe(false)
  })

  it("treats an empty slot as incomplete, not incompatible", () => {
    const r = evaluate([pick("cpu", { socket: "AM5" })], rules, ["motherboard"])

    expect(r.blocking).toHaveLength(0)
    expect(r.missing).toEqual(["motherboard"])
  })

  it("is submittable when everything is chosen and nothing clashes", () => {
    const r = evaluate(
      [
        pick("cpu", { socket: "AM5" }),
        pick("motherboard", { socket: "AM5" }),
      ],
      rules,
      ["cpu", "motherboard"]
    )

    expect(r.submittable).toBe(true)
  })
})

describe("acknowledging warnings", () => {
  const withWarning = () =>
    evaluate(
      [
        pick("psu", { wattage: 750 }),
        pick("gpu", { recommended_psu_watts: 750 }),
      ],
      rules
    )

  it("holds submission until a warning is acknowledged", () => {
    const r = withWarning()
    const check = canSubmit(r, [])

    expect(check.ok).toBe(false)
    expect(check.unacknowledged.map((f) => f.code)).toContain("psu_margin")
  })

  it("allows submission once acknowledged", () => {
    // §7.3 — a recommendation may be overridden after acknowledgement.
    expect(canSubmit(withWarning(), ["psu_margin"]).ok).toBe(true)
  })

  it("never lets a blocking failure be acknowledged away", () => {
    const r = evaluate(
      [pick("cpu", { socket: "AM5" }), pick("motherboard", { socket: "LGA1700" })],
      rules
    )

    expect(canSubmit(r, ["cpu_socket"]).ok).toBe(false)
  })

  it("ignores an acknowledgement for a warning no longer raised", () => {
    const clean = evaluate(
      [pick("psu", { wattage: 1200 }), pick("gpu", { recommended_psu_watts: 750 })],
      rules
    )

    expect(canSubmit(clean, ["psu_margin"]).ok).toBe(true)
  })
})

describe("estimates", () => {
  it("totals picks by quantity", () => {
    const total = estimateTotal(
      [
        pick("memory", {}, { option_id: "ram", quantity: 2 }),
        pick("cpu", {}, { option_id: "cpu" }),
      ],
      { ram: 5_000_000, cpu: 30_000_000 }
    )

    expect(total).toBe(40_000_000)
  })

  it("treats an unpriced option as zero rather than failing", () => {
    const total = estimateTotal([pick("cpu", {}, { option_id: "cpu" })], {})
    expect(total).toBe(0)
  })
})
