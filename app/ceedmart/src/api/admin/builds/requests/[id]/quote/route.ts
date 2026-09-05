import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../../../modules/build"
import {
  assertQuotable,
  computeQuoteTotals,
  defaultValidUntil,
  generateReference,
  type QuoteLineItem,
} from "../../../../../../lib/build/quotes"
import { actorFromRequest } from "../../../../../../lib/state-machine"
import { buildOrderMachine } from "../../../../../../lib/state-machine/machines"
import { sendNotification } from "../../../../../../lib/notifications/send"

// Issue a quote version for a build request (BRD §7.6, P2-3).
//
// Every call creates a NEW VERSION. There is no update path, because §7.6
// requires changes to create a new version without overwriting prior ones —
// a revision is a fresh row, and the previous version stays exactly as the
// customer saw it.
//
// The totals are recomputed server-side from the line items rather than
// trusted from the request body (§7.9), so a quote's total always follows
// from its own contents.

type Body = {
  line_items: QuoteLineItem[]
  service_items?: QuoteLineItem[]
  discount_total?: number
  tax_total?: number
  delivery_total?: number
  build_days?: number
  warranty_text?: string
  cancellation_terms?: string
  valid_until?: string
  change_note?: string
  /** Send it to the customer immediately rather than leaving a draft. */
  send?: boolean
}

const STOREFRONT_URL = (process.env.STORE_CORS || "https://ceedmart.com")
  .split(",")[0]
  .replace(/\/$/, "")

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const requestId = req.params.id
  const body = req.body || ({} as Body)

  const svc: any = req.scope.resolve(BUILD_MODULE)

  const request = await svc.retrieveBuildRequest(requestId).catch(() => null)
  if (!request) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Build request with id: ${requestId} was not found`
    )
  }

  assertQuotable(body.line_items)

  const totals = computeQuoteTotals(
    body.line_items,
    body.service_items ?? [],
    {
      discount_total: body.discount_total,
      tax_total: body.tax_total,
      delivery_total: body.delivery_total,
    }
  )

  // One quote per request; revisions are versions of it.
  let [quote] = await svc.listBuildQuotes({ request_id: requestId }, { take: 1 })
  if (!quote) {
    quote = await svc.createBuildQuotes({
      request_id: requestId,
      reference: generateReference("CQ"),
      status: "draft",
      version_count: 0,
    })
  }

  if (quote.status === "accepted") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This quote has been accepted. Revising it now would change an agreement the customer already made."
    )
  }

  const nextVersion = (quote.version_count ?? 0) + 1
  const now = new Date()

  const version = await svc.createBuildQuoteVersions({
    quote_id: quote.id,
    version: nextVersion,
    line_items: body.line_items,
    service_items: body.service_items ?? null,
    subtotal: totals.subtotal,
    discount_total: totals.discount_total,
    tax_total: totals.tax_total,
    delivery_total: totals.delivery_total,
    total: totals.total,
    currency_code: request.currency_code ?? "ngn",
    build_days: body.build_days ?? null,
    warranty_text: body.warranty_text ?? null,
    cancellation_terms: body.cancellation_terms ?? null,
    valid_until: body.valid_until ? new Date(body.valid_until) : defaultValidUntil(now),
    change_note: body.change_note ?? null,
    prepared_by: actorFromRequest(req).label ?? null,
    sent_at: body.send ? now : null,
  })

  await svc.updateBuildQuotes({
    id: quote.id,
    current_version_id: version.id,
    version_count: nextVersion,
    status: body.send ? "sent" : quote.status === "draft" ? "draft" : "sent",
  })

  await buildOrderMachine.record(req.scope, {
    entityId: quote.id,
    action: nextVersion === 1 ? "quote.created" : "quote.revised",
    actor: actorFromRequest(req),
    toValue: `v${nextVersion}`,
    changes: { total: totals.total, change_note: body.change_note ?? null },
    correlationId: requestId,
  })

  // Move the request along its own machine, but only when the transition is
  // legal from where it is — a revision after "revision_requested" comes
  // from a different state than the first quote.
  const nextStatus = "quote_ready"
  if (buildOrderMachine.canTransition(request.status, nextStatus)) {
    await buildOrderMachine.transition(req.scope, {
      entityId: requestId,
      from: request.status,
      to: nextStatus,
      actor: actorFromRequest(req),
      correlationId: requestId,
    })
    await svc.updateBuildRequests({ id: requestId, status: nextStatus })
  }

  if (body.send) {
    const validUntil = new Date(version.valid_until).toDateString()
    const text = [
      `Hi ${request.customer_name},`,
      ``,
      nextVersion === 1
        ? `Your custom build quote is ready.`
        : `We've updated your quote${body.change_note ? ` — ${body.change_note}` : "."}`,
      ``,
      `Reference: ${quote.reference} (version ${nextVersion})`,
      `Total: NGN ${(totals.total / 100).toLocaleString()}`,
      body.build_days ? `Build time: about ${body.build_days} days once you accept.` : "",
      `Valid until ${validUntil}.`,
      ``,
      `Review and accept it here: ${STOREFRONT_URL}/builds/${quote.reference}`,
      ``,
      `— Ceedmart`,
    ]
      .filter(Boolean)
      .join("\n")

    await sendNotification(req.scope, {
      to: request.customer_email,
      channel: "email",
      template: "build-quote-sent",
      triggerType: "build.quote_sent",
      resourceId: quote.id,
      resourceType: "build_quote",
      correlationId: requestId,
      content: {
        subject: `Your Ceedmart build quote ${quote.reference}`,
        text,
        html: text.replace(/\n/g, "<br/>"),
      },
    })
  }

  res.status(201).json({ quote, version })
}
