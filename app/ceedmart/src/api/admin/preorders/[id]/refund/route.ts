import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PREORDER_MODULE } from "../../../../../modules/preorder"
import { actorFromRequest } from "../../../../../lib/state-machine"
import { preorderMachine } from "../../../../../lib/state-machine/machines"
import {
  REFUND_REASONS,
  automaticRefundAmount,
  cancellationWindow,
  isValidReasonCode,
  owesFullRefund,
} from "../../../../../lib/preorder/cancellation"
import { notifyMilestone } from "../../../../../lib/preorder/notify"

// Start a refund on a pre-order (BRD §6.4 "staff can issue full or partial
// refunds with reason codes").
//
// This records the DECISION and moves the pre-order to refund_pending. It
// does not move money — that stays with the payment provider, and Pulse
// Pay's partial-refund support is still unverified (risk R2 in the gap
// analysis). Keeping the decision and the disbursement separate means the
// audit trail is correct today and the disbursement can be wired in behind
// it once the gateway capability is confirmed.

type Body = {
  reason_code: string
  amount?: number
  note?: string
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as Body)
  const reasonCode = (body.reason_code || "").trim()

  if (!isValidReasonCode(reasonCode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `reason_code must be one of ${Object.keys(REFUND_REASONS).join(", ")}`
    )
  }

  const svc: any = req.scope.resolve(PREORDER_MODULE)
  const preorder = await svc.retrievePreorderOrder(id).catch(() => null)
  if (!preorder) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Pre-order with id: ${id} was not found`
    )
  }

  const paid =
    Number(preorder.unit_price ?? 0) * Number(preorder.quantity ?? 1)
  const window = cancellationWindow(preorder.status)

  // Work out what is owed. When the failure is ours the cancellation cutoff
  // does not apply — charging someone for our inability to deliver is not a
  // policy. Otherwise the window decides, and after commitment a human has
  // to name the figure rather than us guessing one.
  let amount: number
  if (typeof body.amount === "number") {
    if (!Number.isFinite(body.amount) || body.amount <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "amount must be a positive value in kobo"
      )
    }
    if (body.amount > paid) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Refund of ${body.amount} exceeds the ${paid} paid for this pre-order`
      )
    }
    amount = body.amount
  } else if (owesFullRefund(reasonCode)) {
    amount = paid
  } else {
    const automatic = automaticRefundAmount(preorder.status, paid)
    if (automatic === null) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `This pre-order is past the free-cancellation cutoff (status "${preorder.status}"). Specify an explicit refund amount.`
      )
    }
    amount = automatic
  }

  const reason = `${REFUND_REASONS[reasonCode].label}${body.note ? ` — ${body.note}` : ""}`

  await preorderMachine.transition(req.scope, {
    entityId: id,
    from: preorder.status,
    to: "refund_pending",
    actor: actorFromRequest(req),
    reason,
    correlationId: preorder.order_id,
    changes: {
      reason_code: reasonCode,
      refund_amount: amount,
      amount_paid: paid,
      is_partial: amount < paid,
      cancellation_window: window,
    },
  })

  const now = new Date()
  const updated = await svc.updatePreorderOrders({
    id,
    status: "refund_pending",
    exception_reason: reason,
    exception_at: now,
  })
  const next = Array.isArray(updated) ? updated[0] : updated

  await svc.createPreorderMilestones({
    preorder_order_id: id,
    status: "refund_pending",
    occurred_at: now,
    internal_note: `Refund ${amount} of ${paid} kobo — ${reasonCode}`,
    customer_note: body.note ?? null,
  })

  await notifyMilestone(req.scope, next, {
    status: "refund_pending",
    customerNote: body.note,
  })

  res.json({
    preorder: next,
    refund: {
      amount,
      amount_paid: paid,
      is_partial: amount < paid,
      reason_code: reasonCode,
      // Explicit so the admin UI never implies money has moved.
      disbursed: false,
      note: "Refund recorded. Disburse through the payment provider to complete it.",
    },
  })
}
