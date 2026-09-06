import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../../modules/build"
import { actorFromRequest } from "../../../../../lib/state-machine"
import { buildOrderMachine } from "../../../../../lib/state-machine/machines"
import { sendNotification } from "../../../../../lib/notifications/send"

// Move a build request through the states a SPECIALIST controls
// (BRD §7.5, §7.7).
//
// The request machine has two kinds of transition. Customer-driven ones —
// accepting, rejecting or asking to revise a quote — already have a home in
// /store/builds/quotes/[id]. These are the staff ones, and until now they
// had no endpoint at all: a request arrived as `submitted` and the only
// thing anyone could do was quote it. There was no way to say "I'm looking
// at this", "I need more from you", or "we can't help with this".
//
// `more_information_required` is the important one. §7.5 requires staff be
// able to "communicate clarifying questions without losing the request
// history", and a specialist who cannot ask a question either guesses or
// lets the request rot.

type Body = {
  status: string
  reason?: string
  /** Question or note sent to the customer. Required when asking for more
   *  information — the state means nothing without the question. */
  message?: string
  assigned_to?: string
}

const STAFF_TRANSITIONS = new Set([
  "under_review",
  "more_information_required",
  "rejected",
  "cancelled",
  "unable_to_fulfil",
])

const SPECIALIST_INBOX =
  process.env.BUILD_SPECIALIST_EMAIL || "victor@ceedmart.com"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_MODULE)

  const request = await svc.retrieveBuildRequest(req.params.id).catch(() => null)
  if (!request) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Build request ${req.params.id} was not found`
    )
  }

  const [quotes, orders] = await Promise.all([
    svc.listBuildQuotes({ request_id: request.id }, { take: 5 }),
    svc.listBuildOrders({ request_id: request.id }, { take: 5 }),
  ])

  // Every version, so a specialist can see what was quoted before without
  // opening each one.
  const quoteId = (quotes as any[])[0]?.id
  const versions = quoteId
    ? await svc.listBuildQuoteVersions(
        { quote_id: quoteId },
        { order: { version: "DESC" }, take: 20 }
      )
    : []

  res.json({
    request,
    quote: (quotes as any[])[0] ?? null,
    versions,
    build: (orders as any[])[0] ?? null,
    // What this request can legally move to right now, so the UI offers
    // exactly those and nothing else.
    available_transitions: buildOrderMachine
      .nextStates(request.status as any)
      .filter((s) => STAFF_TRANSITIONS.has(s)),
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as Body)
  const status = (body.status || "").trim()

  const svc: any = req.scope.resolve(BUILD_MODULE)
  const request = await svc.retrieveBuildRequest(id).catch(() => null)
  if (!request) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Build request ${id} was not found`
    )
  }

  // Assignment on its own, without a state change.
  if (!status && body.assigned_to !== undefined) {
    const updated = await svc.updateBuildRequests({
      id,
      assigned_to: body.assigned_to || null,
    })
    await buildOrderMachine.record(req.scope, {
      entityId: id,
      action: "request.assigned",
      actor: actorFromRequest(req),
      toValue: body.assigned_to || null,
    })
    res.json({ request: Array.isArray(updated) ? updated[0] : updated })
    return
  }

  if (!STAFF_TRANSITIONS.has(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `status must be one of ${[...STAFF_TRANSITIONS].join(", ")}. Quote acceptance and revision come from the customer.`
    )
  }

  // Asking for more information without asking anything is just a status
  // the customer cannot act on.
  if (status === "more_information_required" && !body.message?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Include the question you want to ask — the customer gets it by email."
    )
  }

  await buildOrderMachine.transition(req.scope, {
    entityId: id,
    from: request.status,
    to: status,
    actor: actorFromRequest(req),
    reason: body.reason ?? body.message,
    correlationId: id,
  })

  const now = new Date()
  const update: Record<string, any> = { id, status }

  // Track when the ball went to the customer, so the queue can sort
  // "waiting on us" above "waiting on them".
  if (status === "more_information_required") {
    update.awaiting_customer_since = now
  } else if (request.awaiting_customer_since) {
    update.awaiting_customer_since = null
  }

  if (body.assigned_to !== undefined) {
    update.assigned_to = body.assigned_to || null
  }

  const updated = await svc.updateBuildRequests(update)

  // Tell the customer when the transition is one they need to act on or
  // would otherwise be left wondering about.
  const CUSTOMER_COPY: Record<string, { subject: string; body: string }> = {
    more_information_required: {
      subject: `A question about your build request ${request.reference}`,
      body: `${body.message?.trim() ?? ""}\n\nJust reply to this email and we'll pick it up.`,
    },
    rejected: {
      subject: `About your build request ${request.reference}`,
      body:
        body.message?.trim() ||
        body.reason?.trim() ||
        "We're sorry — we're not able to take this one on.",
    },
    unable_to_fulfil: {
      subject: `We can't complete your build ${request.reference}`,
      body:
        body.message?.trim() ||
        body.reason?.trim() ||
        "We've hit a problem we can't work around. We'll be in touch about next steps.",
    },
  }

  const copy = CUSTOMER_COPY[status]
  if (copy && request.customer_email) {
    const text = [
      `Hi ${request.customer_name},`,
      ``,
      copy.body,
      ``,
      `Reference: ${request.reference}`,
      `— Ceedmart`,
    ].join("\n")

    await sendNotification(req.scope, {
      to: request.customer_email,
      channel: "email",
      template: "build-request-update",
      triggerType: `build.${status}`,
      resourceId: id,
      resourceType: "build_request",
      correlationId: id,
      content: {
        subject: copy.subject,
        text,
        html: text.replace(/\n/g, "<br/>"),
      },
    })
  }

  res.json({ request: Array.isArray(updated) ? updated[0] : updated })
}
