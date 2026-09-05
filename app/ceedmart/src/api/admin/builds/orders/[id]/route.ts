import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_MODULE } from "../../../../../modules/build"
import { assertReadyForDispatch, summarise } from "../../../../../lib/build/qa"
import { actorFromRequest } from "../../../../../lib/state-machine"
import { buildOrderMachine } from "../../../../../lib/state-machine/machines"
import { sendNotification } from "../../../../../lib/notifications/send"

// Move a build through assembly, QA and dispatch (BRD §7.7, §7.10).
//
// The one rule this route exists to enforce: a build cannot be marked ready
// for dispatch until every required QA check has passed. §7.10 makes that
// an acceptance criterion, so it is checked here — at the transition —
// rather than trusted to the UI that calls it.

type Body = {
  status: string
  reason?: string
  customer_note?: string
  internal_note?: string
  delay_reason?: string
  expected_next_at?: string
}

const EXCEPTION_STATUSES = new Set([
  "unable_to_fulfil",
  "refund_pending",
  "cancelled",
])

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_MODULE)

  const build = await svc.retrieveBuildOrder(req.params.id).catch(() => null)
  if (!build) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Build with id: ${req.params.id} was not found`
    )
  }

  const [checks, milestones] = await Promise.all([
    svc.listQaChecks(
      { build_order_id: build.id },
      { order: { sort_order: "ASC" }, take: 100 }
    ),
    svc.listBuildMilestones(
      { build_order_id: build.id },
      { order: { occurred_at: "ASC" }, take: 100 }
    ),
  ])

  res.json({ build, qa: summarise(checks as any[]), checks, milestones })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as Body)
  const status = (body.status || "").trim()

  const svc: any = req.scope.resolve(BUILD_MODULE)
  const build = await svc.retrieveBuildOrder(id).catch(() => null)
  if (!build) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Build with id: ${id} was not found`
    )
  }

  // §7.10 — the dispatch gate. Checked before the transition so a blocked
  // build is not left with an audit row implying it moved.
  if (status === "ready_for_dispatch") {
    const checks = await svc.listQaChecks(
      { build_order_id: id },
      { order: { sort_order: "ASC" }, take: 100 }
    )
    assertReadyForDispatch(checks as any[])
  }

  await buildOrderMachine.transition(req.scope, {
    entityId: id,
    from: build.status,
    to: status,
    actor: actorFromRequest(req),
    reason: body.reason,
    correlationId: build.request_id,
  })

  const now = new Date()
  const update: Record<string, any> = { id, status }

  if (EXCEPTION_STATUSES.has(status)) {
    update.exception_reason = body.reason ?? null
    update.exception_at = now
  } else if (build.exception_at) {
    update.exception_reason = null
    update.exception_at = null
  }

  // The customer's promised ready date only becomes real once parts are in
  // hand — before that it is an estimate against components we have not
  // sourced.
  if (status === "parts_sourcing" && build.build_days && !build.promised_ready_date) {
    const ready = new Date(now.getTime())
    ready.setDate(ready.getDate() + Number(build.build_days))
    update.promised_ready_date = ready
  }

  const updated = await svc.updateBuildOrders(update)
  const next = Array.isArray(updated) ? updated[0] : updated

  await svc.createBuildMilestones({
    build_order_id: id,
    status,
    occurred_at: now,
    expected_next_at: body.expected_next_at ? new Date(body.expected_next_at) : null,
    customer_note: body.customer_note ?? null,
    internal_note: body.internal_note ?? null,
    delay_reason: body.delay_reason ?? null,
  })

  // Tell the customer when there is something worth telling them.
  const CUSTOMER_FACING: Record<string, string> = {
    paid: "Payment received — we're sourcing your parts.",
    parts_sourcing: "We're sourcing the parts for your build.",
    assembly: "Your machine is being built.",
    quality_assurance: "Your build is going through our QA checks.",
    ready_for_dispatch: "Your build has passed QA and is ready to go.",
    out_for_delivery: "Your build is on its way to you.",
    delivered: "Your build has been delivered. Enjoy it.",
    unable_to_fulfil: "We've hit a problem completing your build — we'll be in touch.",
  }

  if (CUSTOMER_FACING[status]) {
    const request = await svc.retrieveBuildRequest(build.request_id).catch(() => null)
    if (request?.customer_email) {
      const text = [
        `Hi ${request.customer_name},`,
        ``,
        CUSTOMER_FACING[status],
        body.customer_note?.trim() || "",
        ``,
        `Reference: ${build.reference}`,
        `— Ceedmart`,
      ]
        .filter(Boolean)
        .join("\n")

      await sendNotification(req.scope, {
        to: request.customer_email,
        channel: "email",
        template: "build-milestone",
        triggerType: `build.${status}`,
        resourceId: id,
        resourceType: "build_order",
        correlationId: build.request_id,
        content: {
          subject: `Your build ${build.reference} — ${status.replace(/_/g, " ")}`,
          text,
          html: text.replace(/\n/g, "<br/>"),
        },
      })
    }
  }

  res.json({ build: next })
}
