import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../modules/preorder"
import { actorFromRequest } from "../../../../lib/state-machine"
import {
  PREORDER_CUSTOMER_STAGE,
  preorderMachine,
} from "../../../../lib/state-machine/machines"
import {
  accumulatedPausedDays,
  promisedDeliveryDate,
} from "../../../../lib/preorder/estimate"
import { notifyMilestone } from "../../../../lib/preorder/notify"

// Move a pre-order through its milestones (BRD §6.4).
//
// Every transition is validated by preorderMachine, which also writes the
// audit row, and every accepted move appends a milestone the customer can
// see. Staff can attach carrier, tracking, expected next date and a delay
// reason as part of the same call — those are exactly the facts a customer
// asks for when an order goes quiet.

type Body = {
  status: string
  reason?: string
  carrier?: string
  tracking_reference?: string
  tracking_url?: string
  expected_next_at?: string
  customer_note?: string
  internal_note?: string
  delay_reason?: string
  /** Set when the transition is caused by waiting on the customer, so the
   *  promised-date clock pauses rather than the date quietly slipping. */
  pause_clock?: boolean
  resume_clock?: boolean
}

const EXCEPTION_STATUSES = new Set([
  "delivery_exception",
  "unable_to_source",
  "refund_pending",
  "cancelled",
])

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(PREORDER_MODULE)

  const preorder = await svc
    .retrievePreorderOrder(req.params.id)
    .catch(() => null)
  if (!preorder) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order with id: ${req.params.id} was not found`
    )
  }

  const [milestones, approvals] = await Promise.all([
    svc.listPreorderMilestones(
      { preorder_order_id: preorder.id },
      { order: { occurred_at: "ASC" }, take: 100 }
    ),
    svc.listCustomerApprovals(
      { preorder_order_id: preorder.id },
      { order: { requested_at: "DESC" }, take: 50 }
    ),
  ])

  res.json({
    preorder: {
      ...preorder,
      customer_stage: PREORDER_CUSTOMER_STAGE[preorder.status] ?? preorder.status,
    },
    milestones,
    approvals,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as Body)
  const status = (body.status || "").trim()

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const existing = await svc.retrievePreorderOrder(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order with id: ${id} was not found`
    )
  }

  // Validates the move and writes the audit row. Throws before anything is
  // persisted if the move is illegal or an exception lacks a reason.
  await preorderMachine.transition(req.scope, {
    entityId: id,
    from: existing.status,
    to: status,
    actor: actorFromRequest(req),
    reason: body.reason,
    correlationId: existing.order_id,
  })

  const now = new Date()
  const update: Record<string, any> = { id, status }

  // §6.2 — the promise runs from sourcing confirmation, so that is where
  // the clock starts and where the promised date first becomes real.
  if (status === "sourcing_confirmed" && !existing.clock_started_at) {
    update.clock_started_at = now
    update.promised_delivery_date = promisedDeliveryDate(
      { total_days_override: existing.estimate_days },
      now,
      existing.paused_days ?? 0
    )
  }

  if (body.pause_clock && !existing.paused_at) {
    update.paused_at = now
  }

  if (body.resume_clock && existing.paused_at) {
    const paused = accumulatedPausedDays(
      existing.paused_days ?? 0,
      new Date(existing.paused_at),
      now
    )
    update.paused_at = null
    update.paused_days = paused
    // Re-project the promise so paused time is added rather than absorbed.
    if (existing.clock_started_at) {
      update.promised_delivery_date = promisedDeliveryDate(
        { total_days_override: existing.estimate_days },
        new Date(existing.clock_started_at),
        paused
      )
    }
  }

  if (EXCEPTION_STATUSES.has(status)) {
    update.exception_reason = body.reason ?? null
    update.exception_at = now
  } else if (existing.exception_at) {
    // Recovered — clear the flag so the ops queue stops surfacing it.
    update.exception_reason = null
    update.exception_at = null
  }

  if (body.carrier) update.carrier = body.carrier
  if (body.tracking_reference) update.tracking_reference = body.tracking_reference
  if (body.tracking_url) update.tracking_url = body.tracking_url

  const updated = await svc.updatePreorderOrders(update)
  const preorder = Array.isArray(updated) ? updated[0] : updated

  await svc.createPreorderMilestones({
    preorder_order_id: id,
    status,
    occurred_at: now,
    expected_next_at: body.expected_next_at
      ? new Date(body.expected_next_at)
      : null,
    carrier: body.carrier ?? null,
    tracking_reference: body.tracking_reference ?? null,
    tracking_url: body.tracking_url ?? null,
    customer_note: body.customer_note ?? null,
    internal_note: body.internal_note ?? null,
    delay_reason: body.delay_reason ?? null,
  })

  // §6.6 — the customer receives a notification at every configured
  // material milestone. Never fails the transition.
  await notifyMilestone(req.scope, preorder, {
    status,
    customerNote: body.customer_note,
    delayReason: body.delay_reason,
  })

  res.json({
    preorder: {
      ...preorder,
      customer_stage: PREORDER_CUSTOMER_STAGE[status] ?? status,
    },
  })
}
