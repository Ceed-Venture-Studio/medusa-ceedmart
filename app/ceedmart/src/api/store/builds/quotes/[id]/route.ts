import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../../modules/build"
import { TERMS_SLUGS } from "../../../../../modules/terms"
import { canAcceptVersion, generateReference } from "../../../../../lib/build/quotes"
import { templateFor } from "../../../../../lib/build/qa"
import { buildOrderMachine } from "../../../../../lib/state-machine/machines"
import { SYSTEM_ACTOR } from "../../../../../lib/state-machine"
import { getCurrentVersion, recordAcceptance, evidenceFromRequest } from "../../../../../lib/terms"
import { sendNotification } from "../../../../../lib/notifications/send"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Customer view of a quote, and the accept / reject / revise decision
// (BRD §7.6, §7.7).
//
// Addressed by REFERENCE rather than id, because the reference is what the
// customer has — it is in their email and they read it to support. Guests
// can reach it: a build request does not require an account, and forcing
// one at the accept step would strand a customer who is ready to buy.

const SPECIALIST_INBOX =
  process.env.BUILD_SPECIALIST_EMAIL || "victor@ceedmart.com"

type Body = {
  action: "accept" | "reject" | "request_revision"
  note?: string
}

const loadByReference = async (svc: any, reference: string) => {
  const [quote] = await svc.listBuildQuotes({ reference }, { take: 1 })
  if (!quote) return null

  const version = quote.current_version_id
    ? await svc.retrieveBuildQuoteVersion(quote.current_version_id).catch(() => null)
    : null

  const request = await svc.retrieveBuildRequest(quote.request_id).catch(() => null)
  return { quote, version, request }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.CUSTOM_BUILD)

  const svc: any = req.scope.resolve(BUILD_MODULE)
  const loaded = await loadByReference(svc, req.params.id)

  if (!loaded?.version) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Quote ${req.params.id} was not found`
    )
  }

  const { quote, version, request } = loaded
  const acceptability = canAcceptVersion(quote, version)
  const terms = await getCurrentVersion(req.scope, TERMS_SLUGS.CUSTOM_BUILD)

  res.json({
    quote: {
      reference: quote.reference,
      status: quote.status,
      version: version.version,
      // Prior versions are listed but not returned in full — the customer
      // acts on the current one, and showing five supersedes invites them
      // to argue for an old price.
      version_count: quote.version_count,
      line_items: version.line_items,
      service_items: version.service_items,
      subtotal: Number(version.subtotal),
      discount_total: Number(version.discount_total),
      tax_total: Number(version.tax_total),
      delivery_total: Number(version.delivery_total),
      total: Number(version.total),
      currency_code: version.currency_code,
      build_days: version.build_days,
      warranty_text: version.warranty_text,
      cancellation_terms: version.cancellation_terms,
      valid_until: version.valid_until,
      change_note: version.change_note,
      build_type: request?.build_type ?? null,
      can_accept: acceptability.acceptable,
      blocked_reason: acceptability.message ?? null,
      terms: terms
        ? { version_id: terms.id, version: terms.version, body: terms.body }
        : null,
    },
  })
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.CUSTOM_BUILD)

  const action = req.body?.action
  const svc: any = req.scope.resolve(BUILD_MODULE)
  const loaded = await loadByReference(svc, req.params.id)

  if (!loaded?.version || !loaded.request) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Quote ${req.params.id} was not found`
    )
  }

  const { quote, version, request } = loaded
  const now = new Date()

  if (action === "reject" || action === "request_revision") {
    const to = action === "reject" ? "rejected" : "revision_requested"

    await buildOrderMachine.transition(req.scope, {
      entityId: request.id,
      from: request.status,
      to,
      actor: { type: "customer", id: request.customer_id, label: request.customer_email },
      reason: req.body?.note ?? (action === "reject" ? "Customer rejected the quote" : "Customer asked for changes"),
      correlationId: request.id,
    })

    await svc.updateBuildRequests({ id: request.id, status: to })
    await svc.updateBuildQuotes({
      id: quote.id,
      status: action === "reject" ? "rejected" : "sent",
      rejected_at: action === "reject" ? now : null,
      rejection_reason: action === "reject" ? req.body?.note ?? null : null,
    })

    await sendNotification(req.scope, {
      to: SPECIALIST_INBOX,
      channel: "email",
      template: "build-quote-response",
      triggerType: `build.quote_${to}`,
      resourceId: quote.id,
      resourceType: "build_quote",
      correlationId: request.id,
      content: {
        subject: `${quote.reference} — customer ${action === "reject" ? "rejected" : "asked for changes"}`,
        text: `${request.customer_name} (${request.customer_email})\n\n${req.body?.note ?? "No note given."}\n\n— Ceedmart`,
      },
    })

    res.json({ quote: { reference: quote.reference, status: to } })
    return
  }

  if (action !== "accept") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "action must be accept, reject or request_revision"
    )
  }

  // §7.6 — only the latest valid quote can be accepted. Checked here rather
  // than trusted from the client, because the link in the customer's inbox
  // is the one thing we do not control.
  const acceptability = canAcceptVersion(quote, version, now)
  if (!acceptability.acceptable) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      acceptability.message ?? "This quote can no longer be accepted."
    )
  }

  // §7.6 — acceptance records identity, timestamp, version, configuration
  // snapshot, price and terms version.
  let termsVersionId: string | null = null
  try {
    termsVersionId = await recordAcceptance(req.scope, {
      slug: TERMS_SLUGS.CUSTOM_BUILD,
      entityType: "build_quote",
      entityId: quote.id,
      customerId: request.customer_id,
      contact: request.customer_email,
      evidence: evidenceFromRequest(req),
    })
  } catch {
    // No published build terms yet. The acceptance still stands — blocking
    // a ready customer on our own missing configuration would be worse —
    // but it is recorded without a terms reference.
  }

  await buildOrderMachine.transition(req.scope, {
    entityId: request.id,
    from: request.status,
    to: "quote_accepted",
    actor: { type: "customer", id: request.customer_id, label: request.customer_email },
    correlationId: request.id,
    changes: { quote_version: version.version, total: Number(version.total) },
  })

  await svc.updateBuildQuotes({
    id: quote.id,
    status: "accepted",
    accepted_version_id: version.id,
    accepted_at: now,
    accepted_by: request.customer_email,
    terms_version_id: termsVersionId,
  })
  await svc.updateBuildRequests({ id: request.id, status: "quote_accepted" })

  // The build order: a frozen copy of what was agreed. The quote version
  // stays readable, but this is what the build runs against.
  const buildOrder = await svc.createBuildOrders({
    request_id: request.id,
    quote_id: quote.id,
    quote_version_id: version.id,
    reference: generateReference("CB"),
    customer_id: request.customer_id,
    configuration_snapshot: {
      line_items: version.line_items,
      service_items: version.service_items,
      build_type: request.build_type,
      intended_use: request.intended_use,
    },
    total: Number(version.total),
    currency_code: version.currency_code,
    terms_version_id: termsVersionId,
    status: "quote_accepted",
    build_days: version.build_days ?? null,
  })

  // Seed the QA checklist now, from the fixed template. Creating it at
  // acceptance rather than at assembly means it cannot be assembled ad hoc
  // for a build that is running late.
  const template = templateFor(request.build_type === "laptop" ? "laptop" : "desktop")
  for (const item of template) {
    await svc.createQaChecks({
      build_order_id: buildOrder.id,
      code: item.code,
      label: item.label,
      is_required: item.is_required,
      sort_order: item.sort_order,
      result: "pending",
    })
  }

  await svc.createBuildMilestones({
    build_order_id: buildOrder.id,
    status: "quote_accepted",
    occurred_at: now,
    customer_note: "Quote accepted. We'll send payment details shortly.",
  })

  await buildOrderMachine.record(req.scope, {
    entityId: buildOrder.id,
    action: "build.created",
    actor: SYSTEM_ACTOR,
    correlationId: request.id,
    metadata: { quote_reference: quote.reference, total: Number(version.total) },
  })

  res.json({
    build: {
      reference: buildOrder.reference,
      status: buildOrder.status,
      total: Number(buildOrder.total),
      currency_code: buildOrder.currency_code,
    },
  })
}
