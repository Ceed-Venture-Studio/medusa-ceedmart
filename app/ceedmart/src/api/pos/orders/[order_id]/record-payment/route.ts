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

// POS payment recording with explicit provider id.
//
// The stock /admin/payment-collections/:id/mark-as-paid route runs Medusa's
// markPaymentCollectionAsPaid workflow which hardcodes provider_id to
// "pp_system_default" (see core-flows/order/workflows/mark-payment-collection-as-paid.ts).
// That means every order recorded through the admin SDK collapses to one
// provider, losing the per-method reporting we need for cash vs card vs
// bank-transfer vs other.
//
// This endpoint drives the lifecycle ourselves so the cashier's selection
// actually lands on the payment row:
//   1. Find-or-create payment_collection for the order.
//   2. Create payment session with the requested provider_id.
//   3. Authorize the session (manual providers return AUTHORIZED immediately).
//   4. Capture the payment for the full collection amount.

type Body = { provider_id: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { order_id } = req.params
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

  // Find-or-create payment_collection for this order.
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

  // If a session already exists for the requested provider and isn't in a
  // terminal state, reuse it. Otherwise create a fresh one. Medusa's
  // createPaymentSessionsWorkflow deletes existing sessions for the same
  // collection, so we don't need to clean up manually.
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

  // Authorize the session — manual providers immediately return AUTHORIZED
  // and create the payment row tied to the requested provider_id.
  const payment = await paymentModule.authorizePaymentSession(sessionId, {})

  if (!payment?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Authorize did not return a payment id for session ${sessionId}`
    )
  }

  // Capture for the full collection amount, attributed to the operator.
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
