// Compatibility engine for guided builds (BRD §7.3, §7.9, §7.10).
//
// ── What it has to do ───────────────────────────────────────────────────
// §7.3 lists the relationships to cover — CPU socket vs motherboard, memory
// type and slot count, case and board form factor, GPU and cooler
// clearance, PSU headroom and connectors, storage interface, OS support —
// and demands that "warnings must distinguish between a HARD
// INCOMPATIBILITY that blocks submission and a RECOMMENDATION that the
// customer may override after acknowledgement".
//
// §7.10 adds that "the system explains every blocking compatibility
// failure", and §7.9 that "all price and compatibility validations must be
// repeated on the server". So this module is the authority; the browser
// copy of it is a convenience.
//
// ── Why rules are data ──────────────────────────────────────────────────
// Each rule is a row comparing an attribute on one slot against an
// attribute on another. Hardcoding them as functions would mean a deploy
// every time a new socket generation arrives — and component compatibility
// changes faster than we ship.
//
// The engine never guesses. A rule whose attributes are missing from either
// side is SKIPPED, not failed: telling a customer their parts are
// incompatible because we lack data about them is worse than staying quiet,
// and a specialist reviews every configuration before it becomes a quote.

export type Severity = "blocking" | "warning"

export type RuleOperator =
  | "equals"
  | "in"
  | "lte"
  | "gte"
  | "sum_lte"
  | "count_lte"

export type Rule = {
  code: string
  left_category: string
  left_attribute: string
  right_category: string
  right_attribute: string
  operator: RuleOperator
  severity: Severity
  message: string
  remedy?: string | null
  factor?: number | null
  is_active?: boolean
}

export type Pick = {
  category_code: string
  option_id: string
  label: string
  quantity: number
  attributes?: Record<string, unknown> | null
}

export type Finding = {
  code: string
  severity: Severity
  message: string
  remedy: string | null
  /** Slots involved, so the UI can highlight the right selectors. */
  categories: string[]
  /** What was actually compared, for support and for the audit trail. */
  detail: { left: unknown; right: unknown } | null
}

export type CompatibilityResult = {
  blocking: Finding[]
  warnings: Finding[]
  /** Required categories with nothing chosen yet. */
  missing: string[]
  /** True when nothing blocks AND every required slot is filled. */
  submittable: boolean
}

// ─── Attribute access ─────────────────────────────────────────────────────

const attr = (pick: Pick, name: string): unknown =>
  pick.attributes ? pick.attributes[name] : undefined

const isPresent = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== ""

const num = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const normalise = (value: unknown): string =>
  String(value).trim().toLowerCase()

// ─── Operators ────────────────────────────────────────────────────────────

type Comparison = { ok: boolean; left: unknown; right: unknown } | null

const compare = (
  operator: RuleOperator,
  lefts: Pick[],
  leftAttr: string,
  right: Pick,
  rightAttr: string,
  factor: number | null | undefined
): Comparison => {
  const rightValue = attr(right, rightAttr)
  if (!isPresent(rightValue)) return null

  switch (operator) {
    case "equals": {
      // Every left pick must match. A build with two CPUs is not our
      // problem here, but the loop costs nothing and is correct.
      const values = lefts.map((p) => attr(p, leftAttr)).filter(isPresent)
      if (!values.length) return null
      const ok = values.every((v) => normalise(v) === normalise(rightValue))
      return { ok, left: values[0], right: rightValue }
    }

    case "in": {
      // The right side is a list the left value must appear in — e.g. a
      // board's supported memory types.
      //
      // The left value may ITSELF be a list, and then it means "supports
      // any of these" rather than "must all be present". A cooler listing
      // ["AM5","LGA1700"] fits an AM5 processor; requiring every one of
      // its sockets to match a single CPU blocked every multi-socket
      // cooler against every processor.
      const allowedList = Array.isArray(rightValue) ? rightValue : [rightValue]
      const allowed = allowedList.map(normalise)
      const values = lefts.map((p) => attr(p, leftAttr)).filter(isPresent)
      if (!values.length) return null

      const ok = values.every((v) =>
        Array.isArray(v)
          ? v.some((item) => allowed.includes(normalise(item)))
          : allowed.includes(normalise(v))
      )
      return { ok, left: values[0], right: allowedList }
    }

    case "lte":
    case "gte": {
      const limit = num(rightValue)
      if (limit === null) return null
      const values = lefts.map((p) => num(attr(p, leftAttr))).filter((v): v is number => v !== null)
      if (!values.length) return null

      const worst = operator === "lte" ? Math.max(...values) : Math.min(...values)
      const adjusted = factor ? limit * factor : limit
      const ok = operator === "lte" ? worst <= adjusted : worst >= adjusted
      return { ok, left: worst, right: adjusted }
    }

    case "sum_lte": {
      // Total across picks, weighted by quantity — total memory capacity
      // against what the board supports, or total draw against the PSU.
      const limit = num(rightValue)
      if (limit === null) return null

      let total = 0
      let sawAny = false
      for (const pick of lefts) {
        const v = num(attr(pick, leftAttr))
        if (v === null) continue
        sawAny = true
        total += v * Math.max(1, pick.quantity || 1)
      }
      if (!sawAny) return null

      const adjusted = factor ? limit / factor : limit
      return { ok: total <= adjusted, left: total, right: adjusted }
    }

    case "count_lte": {
      // Number of units against available slots.
      const limit = num(rightValue)
      if (limit === null) return null
      const count = lefts.reduce((acc, p) => acc + Math.max(1, p.quantity || 1), 0)
      return { ok: count <= limit, left: count, right: limit }
    }

    default:
      return null
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────

/**
 * Evaluate a configuration against the rule set.
 *
 * `requiredCategories` comes from the component categories marked required
 * for this build type. A missing required slot does not produce a finding —
 * it is not an incompatibility, it is an incomplete build — but it does
 * prevent submission.
 */
export const evaluate = (
  picks: Pick[],
  rules: Rule[],
  requiredCategories: string[] = []
): CompatibilityResult => {
  const byCategory = new Map<string, Pick[]>()
  for (const pick of picks) {
    const list = byCategory.get(pick.category_code) ?? []
    list.push(pick)
    byCategory.set(pick.category_code, list)
  }

  const blocking: Finding[] = []
  const warnings: Finding[] = []

  for (const rule of rules) {
    if (rule.is_active === false) continue

    const lefts = byCategory.get(rule.left_category) ?? []
    const rights = byCategory.get(rule.right_category) ?? []

    // Nothing chosen on one side yet — not a failure, just not decidable.
    if (!lefts.length || !rights.length) continue

    // Compare against every pick on the right; a build with two storage
    // controllers should satisfy the rule for each.
    for (const right of rights) {
      const result = compare(
        rule.operator,
        lefts,
        rule.left_attribute,
        right,
        rule.right_attribute,
        rule.factor
      )

      // We lack the data to judge. Staying quiet beats inventing a verdict.
      if (result === null) continue
      if (result.ok) continue

      const finding: Finding = {
        code: rule.code,
        severity: rule.severity,
        message: rule.message,
        remedy: rule.remedy ?? null,
        categories: [rule.left_category, rule.right_category],
        detail: { left: result.left, right: result.right },
      }

      if (rule.severity === "blocking") blocking.push(finding)
      else warnings.push(finding)
    }
  }

  const missing = requiredCategories.filter(
    (code) => !(byCategory.get(code) ?? []).length
  )

  return {
    blocking: dedupe(blocking),
    warnings: dedupe(warnings),
    missing,
    submittable: blocking.length === 0 && missing.length === 0,
  }
}

/** One finding per rule — the same rule failing against three drives is one
 *  problem, and repeating it three times reads as a broken page. */
const dedupe = (findings: Finding[]): Finding[] => {
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const f of findings) {
    if (seen.has(f.code)) continue
    seen.add(f.code)
    out.push(f)
  }
  return out
}

/**
 * Whether a configuration may be submitted given the warnings the customer
 * has acknowledged.
 *
 * §7.3 — a recommendation can be overridden AFTER acknowledgement. Blocking
 * findings can never be overridden, and an acknowledgement of a warning
 * that is no longer raised is ignored rather than carried forward.
 */
export const canSubmit = (
  result: CompatibilityResult,
  acknowledgedCodes: string[] = []
): { ok: boolean; unacknowledged: Finding[] } => {
  const acknowledged = new Set(acknowledgedCodes)
  const unacknowledged = result.warnings.filter((w) => !acknowledged.has(w.code))

  return {
    ok: result.blocking.length === 0 && result.missing.length === 0 && unacknowledged.length === 0,
    unacknowledged,
  }
}

/** Indicative total for a configuration, kobo. Advisory only — §7.9 makes
 *  estimates non-binding until a quote is accepted. */
export const estimateTotal = (
  picks: Pick[],
  priceByOption: Record<string, number | null | undefined>
): number =>
  picks.reduce((acc, pick) => {
    const price = Number(priceByOption[pick.option_id] ?? 0)
    if (!Number.isFinite(price)) return acc
    return acc + price * Math.max(1, pick.quantity || 1)
  }, 0)
