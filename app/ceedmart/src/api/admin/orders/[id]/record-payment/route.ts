import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  capturePaymentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/core-flows"
import type {
  IPaymentModuleService,
  PaymentCollectionDTO,
} from "@medusajs/framework/types"

// Admin-side payment recording with explicit provider id. Mirrors
// /pos/orders/:order_id/record-payment so the admin "Record Payment"
// widget can drive the lifecycle and pick which method the payment
// is reported under (cash / card / bank-transfer / online / other).
//
// Medusa core's /admin/payment-collections/:id/mark-as-paid hardcodes
// provider_id to "pp_system_default" — see mark-payment-collection-as-paid.ts
// in core-flows. Using that route from the admin UI's existing button
// collapses every payment to one provider row. This endpoint replaces
// that flow with the proper lifecycle so reconciliation reports show
// the actual receipt method.

type Body = { provider_id: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id: order_id } = req.params
  const { provider_id } = req.body ?? {}

  if (!provider_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "provider_id is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const paymentModule = req.scope.resolve<IPaymentModuleService>(
    Modules.PAYMENT
  )

  const { data: orderRows } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "total",
      "currency_code",
      "payment_status",
      "payment_collections.id",
      "payment_collections.amount",
      "payment_collections.status",
      "payment_collections.payment_sessions.id",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.status",
    ],
    filters: { id: order_id },
  })
  const order = orderRows[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${order_id} not found`
    )
  }
  if (order.payment_status === "captured") {
    return res.json({
      ok: true,
      already_captured: true,
      order_id,
    })
  }

  let paymentCollection: Pick<
    PaymentCollectionDTO,
    "id" | "amount" | "status"
  > & { payment_sessions?: Array<{ id: string; provider_id: string; status: string }> }
  const existing = order.payment_collections?.[0]
  if (existing) {
    paymentCollection = existing as any
  } else {
    const { result: created } = await createOrderPaymentCollectionWorkflow(
      req.scope
    ).run({
      input: {
        order_id: order.id,
        amount: Number(order.total),
      },
    })
    paymentCollection = created as any
  }

  const reusableSession = paymentCollection.payment_sessions?.find(
    (s) =>
      s.provider_id === provider_id &&
      (s.status === "pending" || s.status === "authorized")
  )
  let sessionId: string
  if (reusableSession) {
    sessionId = reusableSession.id
  } else {
    const { result: session } = await createPaymentSessionsWorkflow(
      req.scope
    ).run({
      input: {
        payment_collection_id: paymentCollection.id,
        provider_id,
        data: {},
        context: {},
      },
    })
    sessionId = (session as any).id
  }

  const payment = await paymentModule.authorizePaymentSession(sessionId, {})

  if (!payment?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Authorize did not return a payment id for session ${sessionId}`
    )
  }

  await capturePaymentWorkflow(req.scope).run({
    input: {
      payment_id: payment.id,
      captured_by: req.auth_context.actor_id,
      amount: paymentCollection.amount,
    },
  })

  res.json({
    ok: true,
    order_id,
    payment_id: payment.id,
    provider_id,
  })
}
