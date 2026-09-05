import { MedusaError } from "@medusajs/framework/utils"

// Quality-assurance checklist for custom builds (BRD §7.9, §7.10).
//
// §7.9: "staff must record quality-assurance results before marking a build
// ready for dispatch."
// §7.10: "staff cannot mark an order ready for dispatch without completing
// the configured QA checklist."
//
// The checklist is a fixed template rather than something a technician
// assembles per build, so it cannot be quietly shortened for a machine that
// is running late — which is exactly the machine most likely to need it.

export type QaTemplateItem = {
  code: string
  label: string
  is_required: boolean
  sort_order: number
  /** Only applies to this build type. Absent means both. */
  build_type?: "desktop" | "laptop"
}

// Written as things a technician physically does, not abstractions. A
// checklist item nobody can picture performing gets ticked without being
// done.
export const QA_TEMPLATE: QaTemplateItem[] = [
  { code: "parts_match_quote", label: "Every component matches the accepted quote", is_required: true, sort_order: 10 },
  { code: "posts", label: "Machine powers on and reaches BIOS/UEFI", is_required: true, sort_order: 20 },
  { code: "ram_detected", label: "All installed memory is detected at rated speed", is_required: true, sort_order: 30 },
  { code: "storage_detected", label: "All storage devices detected and healthy", is_required: true, sort_order: 40 },
  { code: "gpu_output", label: "Graphics output confirmed on every port sold", is_required: true, sort_order: 50, build_type: "desktop" },
  { code: "display_no_defects", label: "Screen checked for dead pixels and backlight bleed", is_required: true, sort_order: 55, build_type: "laptop" },
  { code: "keyboard_trackpad", label: "Every key and the trackpad respond", is_required: true, sort_order: 60, build_type: "laptop" },
  { code: "battery_health", label: "Battery charges and reports healthy capacity", is_required: true, sort_order: 65, build_type: "laptop" },
  { code: "thermals", label: "Temperatures stay in range under a sustained load test", is_required: true, sort_order: 70 },
  { code: "stress_stable", label: "Passes a stability run without crashing or throttling", is_required: true, sort_order: 80 },
  { code: "os_activated", label: "Operating system installed and activated", is_required: true, sort_order: 90 },
  { code: "drivers_updated", label: "Drivers and firmware updated", is_required: true, sort_order: 100 },
  { code: "networking", label: "Wi-Fi, Bluetooth and ethernet all connect", is_required: true, sort_order: 110 },
  { code: "ports_tested", label: "Every external port tested with a device", is_required: true, sort_order: 120 },
  { code: "audio", label: "Audio output and microphone confirmed", is_required: true, sort_order: 130 },
  { code: "cable_management", label: "Internal cabling tidy and clear of fans", is_required: false, sort_order: 140, build_type: "desktop" },
  { code: "cosmetic", label: "No cosmetic damage to case or panels", is_required: true, sort_order: 150 },
  { code: "data_wiped", label: "Any customer data used in setup removed", is_required: true, sort_order: 160 },
  { code: "accessories_packed", label: "All quoted accessories present and packed", is_required: true, sort_order: 170 },
  { code: "serials_recorded", label: "Component serial numbers recorded for warranty", is_required: true, sort_order: 180 },
]

/** The checklist for a build type. */
export const templateFor = (
  buildType: "desktop" | "laptop"
): QaTemplateItem[] =>
  QA_TEMPLATE.filter((item) => !item.build_type || item.build_type === buildType).sort(
    (a, b) => a.sort_order - b.sort_order
  )

export type QaRow = {
  code: string
  label?: string
  is_required: boolean
  result: string
}

export type QaSummary = {
  total: number
  required: number
  passed: number
  failed: number
  pending: number
  /** Required checks not yet passed — what stands between here and
   *  dispatch. */
  outstanding: string[]
  complete: boolean
}

/**
 * Summarise a build's checklist.
 *
 * `complete` means every REQUIRED check has an explicit non-pending,
 * non-failed result. A failed required check blocks dispatch as firmly as
 * an unchecked one: the point is that the machine is fit to ship, not that
 * someone filled in the form.
 */
export const summarise = (rows: QaRow[]): QaSummary => {
  const required = rows.filter((r) => r.is_required)

  const passed = rows.filter((r) => r.result === "passed").length
  const failed = rows.filter((r) => r.result === "failed").length
  const pending = rows.filter((r) => r.result === "pending").length

  const outstanding = required
    .filter((r) => r.result !== "passed" && r.result !== "not_applicable")
    .map((r) => r.label || r.code)

  return {
    total: rows.length,
    required: required.length,
    passed,
    failed,
    pending,
    outstanding,
    // An empty checklist is NOT complete. A build with no QA rows has not
    // passed QA, it has skipped it.
    complete: rows.length > 0 && outstanding.length === 0,
  }
}

/**
 * Throw unless the build may be marked ready for dispatch.
 *
 * The message names what is outstanding rather than saying "QA incomplete",
 * so the technician can go and do it instead of hunting for which line is
 * missing.
 */
export const assertReadyForDispatch = (rows: QaRow[]): void => {
  const summary = summarise(rows)
  if (summary.complete) return

  if (!rows.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This build has no QA checklist. Start QA before marking it ready for dispatch."
    )
  }

  const shown = summary.outstanding.slice(0, 5)
  const more = summary.outstanding.length - shown.length

  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `QA is not complete — ${summary.outstanding.length} required check${
      summary.outstanding.length === 1 ? "" : "s"
    } outstanding: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`
  )
}

/** A failed check has to say why — "it failed" is not a QA record. */
export const assertResultRecordable = (
  result: string,
  notes: string | null | undefined
): void => {
  const allowed = ["pending", "passed", "failed", "not_applicable"]
  if (!allowed.includes(result)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `result must be one of ${allowed.join(", ")}`
    )
  }

  if ((result === "failed" || result === "not_applicable") && !notes?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Recording a check as "${result}" requires a note explaining why`
    )
  }
}
