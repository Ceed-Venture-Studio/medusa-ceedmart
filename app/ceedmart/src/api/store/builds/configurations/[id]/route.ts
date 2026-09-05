import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, validateEmail } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../../../../../modules/build-catalog"
import { BUILD_MODULE } from "../../../../../modules/build"
import { generateReference } from "../../../../../lib/build/quotes"
import { canSubmit, evaluate } from "../../../../../lib/build-catalog/compatibility"
import {
  loadCategories,
  loadRules,
  resolvePicks,
} from "../../../../../lib/build-catalog/load"
import { sendNotification } from "../../../../../lib/notifications/send"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Read a saved configuration, and submit it into the Phase 2 quote pipeline
// (BRD §7.8, §7.2 step 5–6, P3-6).
//
// Submission produces an ordinary BuildRequest, so a guided configuration
// and an assisted request converge on the same specialist review, the same
// versioned quote, and the same QA-gated build. The configurator is a
// better front door, not a second pipeline.

const SPECIALIST_INBOX =
  process.env.BUILD_SPECIALIST_EMAIL || "victor@ceedmart.com"

type Body = {
  customer_name: string
  customer_email: string
  customer_phone?: string
  delivery_state?: string
  needed_by?: string
  notes?: string
  acknowledged_warnings?: string[]
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const [configuration] = await svc.listBuildConfigurations(
    { reference: req.params.id },
    { take: 1 }
  )

  if (!configuration) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Configuration ${req.params.id} was not found`
    )
  }

  const resolved = await resolvePicks(req.scope, configuration.selections ?? [])

  res.json({
    configuration: {
      ...configuration,
      estimated_total:
        configuration.estimated_total === null
          ? null
          : Number(configuration.estimated_total),
      picks: resolved.picks,
    },
  })
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const body = req.body || ({} as Body)
  const catalog: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const builds: any = req.scope.resolve(BUILD_MODULE)

  const [configuration] = await catalog.listBuildConfigurations(
    { reference: req.params.id },
    { take: 1 }
  )
  if (!configuration) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Configuration ${req.params.id} was not found`
    )
  }

  if (configuration.submitted_request_id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This configuration has already been submitted. Duplicate it to start a new request."
    )
  }

  if (!body.customer_name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "customer_name is required")
  }
  validateEmail(body.customer_email)

  // Re-validate at submission. Availability and the rule set may both have
  // moved since the configuration was saved (§7.9), and the client's own
  // verdict is never the authority.
  const [rules, categories, resolved] = await Promise.all([
    loadRules(req.scope),
    loadCategories(req.scope, configuration.build_type),
    resolvePicks(req.scope, configuration.selections ?? []),
  ])

  const required = categories.filter((c: any) => c.is_required).map((c: any) => c.code)
  const result = evaluate(resolved.picks, rules, required)
  const acknowledged =
    body.acknowledged_warnings ?? configuration.acknowledged_warnings ?? []
  const submission = canSubmit(result, acknowledged)

  if (!submission.ok) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      result.blocking.length
        ? result.blocking[0].message
        : result.missing.length
          ? "Some required parts haven't been chosen yet."
          : submission.unacknowledged[0]?.message ??
            "This configuration can't be submitted yet."
    )
  }

  const auth = (req as any).auth_context

  // The configuration, written out as something a specialist can read
  // without opening the configurator.
  const spec = resolved.picks
    .map((p) => `${p.category_code}: ${p.label}${p.quantity > 1 ? ` ×${p.quantity}` : ""}`)
    .join("\n")

  const request = await builds.createBuildRequests({
    reference: generateReference("CB"),
    customer_id: auth?.actor_type === "customer" ? auth.actor_id : null,
    customer_name: body.customer_name.trim(),
    customer_email: body.customer_email.trim().toLowerCase(),
    customer_phone: body.customer_phone?.trim() || null,
    delivery_state: body.delivery_state?.trim() || null,
    build_type: configuration.build_type,
    intended_use: configuration.name?.trim() || "Configured build",
    needed_by: body.needed_by ? new Date(body.needed_by) : null,
    notes: [spec, body.notes?.trim()].filter(Boolean).join("\n\n"),
    status: "submitted",
    metadata: {
      configuration_reference: configuration.reference,
      acknowledged_warnings: acknowledged,
      estimated_total:
        configuration.estimated_total === null
          ? null
          : Number(configuration.estimated_total),
    },
  })

  await catalog.updateBuildConfigurations({
    id: configuration.id,
    submitted_request_id: request.id,
  })

  await sendNotification(req.scope, {
    to: SPECIALIST_INBOX,
    channel: "email",
    template: "build-request-received",
    triggerType: "build.configuration_submitted",
    resourceId: request.id,
    resourceType: "build_request",
    content: {
      subject: `[Ceedmart Builds] ${request.reference} — configured ${configuration.build_type}`,
      text:
        `${body.customer_name} configured this themselves.\n\n${spec}\n\n` +
        (acknowledged.length
          ? `Acknowledged warnings: ${acknowledged.join(", ")}\n\n`
          : "") +
        `Estimate shown to them: ₦${(Number(configuration.estimated_total ?? 0) / 100).toLocaleString()}\n\n— Ceedmart`,
    },
  })

  res.status(201).json({
    request: { reference: request.reference, status: request.status },
  })
}
