import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../../../../modules/build-catalog"
import { generateReference } from "../../../../lib/build/quotes"
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

// Saved configurations (BRD §7.8).
//
// "Signed-in customers can save draft configurations" and they receive
// "human-readable reference numbers". Anonymous shoppers are keyed by a
// browser-held token instead, so someone who spends twenty minutes on a
// build does not lose it because they had not signed in yet.

type Body = {
  name?: string
  build_type?: "desktop" | "laptop"
  model_family?: string
  selections: { category_code: string; option_id: string; quantity?: number }[]
  acknowledged_warnings?: string[]
  session_token?: string
  /** Reference of an existing configuration to copy (§7.8 duplication). */
  copy_from?: string
}

const identify = (req: MedusaRequest, body: Body) => {
  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null
  const sessionToken = body.session_token?.trim() || null
  return { customerId, sessionToken }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null
  const sessionToken =
    typeof req.query.session_token === "string" ? req.query.session_token : null

  if (!customerId && !sessionToken) {
    res.json({ configurations: [] })
    return
  }

  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const configurations = await svc.listBuildConfigurations(
    customerId ? { customer_id: customerId } : { session_token: sessionToken },
    { order: { created_at: "DESC" }, take: 50 }
  )

  res.json({ configurations })
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const body = req.body || ({} as Body)
  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const { customerId, sessionToken } = identify(req, body)

  if (!customerId && !sessionToken) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Sign in or supply a session_token to save a configuration"
    )
  }

  // §7.8 — a saved build can be duplicated and modified. Copying carries the
  // selections but NOT the estimate: prices move, and showing last month's
  // total on a fresh copy would be a quote we never made.
  let selections = body.selections
  let copiedFrom: string | null = null
  let buildType = body.build_type === "laptop" ? "laptop" : "desktop"

  if (body.copy_from) {
    const [source] = await svc.listBuildConfigurations(
      { reference: body.copy_from },
      { take: 1 }
    )
    if (!source) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Configuration ${body.copy_from} was not found`
      )
    }
    selections = source.selections
    buildType = source.build_type
    copiedFrom = source.id
  }

  if (!Array.isArray(selections) || !selections.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A configuration needs at least one component"
    )
  }

  // Re-price and re-validate server-side rather than trusting whatever the
  // client last computed (§7.9).
  const [rules, categories, resolved] = await Promise.all([
    loadRules(req.scope),
    loadCategories(req.scope, buildType as "desktop" | "laptop"),
    resolvePicks(req.scope, selections),
  ])

  const required = categories.filter((c) => c.is_required).map((c) => c.code)
  const result = evaluate(resolved.picks, rules, required)

  const configuration = await svc.createBuildConfigurations({
    reference: generateReference("BC"),
    customer_id: customerId,
    session_token: customerId ? null : sessionToken,
    name: body.name?.trim() || null,
    build_type: buildType,
    model_family: body.model_family ?? null,
    selections,
    estimated_total: estimateTotal(resolved.picks, resolved.prices),
    acknowledged_warnings: body.acknowledged_warnings ?? null,
    copied_from_id: copiedFrom,
  })

  res.status(201).json({
    configuration,
    validation: {
      blocking: result.blocking,
      warnings: result.warnings,
      missing: result.missing,
      can_submit: canSubmit(result, body.acknowledged_warnings ?? []).ok,
    },
  })
}
