import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  canSubmit,
  estimateTotal,
  evaluate,
} from "../../../../lib/build-catalog/compatibility"
import {
  loadCategories,
  loadRules,
  resolvePicks,
} from "../../../../lib/build-catalog/load"
import { FEATURE_FLAGS, assertEnabled } from "../../../../lib/feature-flags"

// Server-side compatibility validation (BRD §7.9, §7.10).
//
// "All price and compatibility validations must be repeated on the server."
// The browser evaluates the same rules for instant feedback, but this is the
// authority — and it reads attributes from the catalogue, never from the
// request body, so a client cannot declare two parts compatible by asserting
// it.

type Body = {
  build_type?: "desktop" | "laptop"
  selections: { category_code: string; option_id: string; quantity?: number }[]
  acknowledged_warnings?: string[]
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const body = req.body || ({} as Body)
  const buildType = body.build_type === "laptop" ? "laptop" : "desktop"
  const selections = Array.isArray(body.selections) ? body.selections : []

  const [rules, categories, resolved] = await Promise.all([
    loadRules(req.scope),
    loadCategories(req.scope, buildType),
    resolvePicks(req.scope, selections),
  ])

  const required = categories.filter((c) => c.is_required).map((c) => c.code)
  const result = evaluate(resolved.picks, rules, required)
  const submission = canSubmit(result, body.acknowledged_warnings ?? [])

  res.json({
    blocking: result.blocking,
    warnings: result.warnings,
    missing: result.missing,
    // Missing required slots are reported by code; the label makes the
    // message usable without a second lookup.
    missing_labels: result.missing.map(
      (code) => categories.find((c) => c.code === code)?.label ?? code
    ),
    unacknowledged: submission.unacknowledged,
    can_submit: submission.ok,
    estimated_total: estimateTotal(resolved.picks, resolved.prices),
    currency_code: "ngn",
  })
}
