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
  Logger,
  PaymentCollectionDTO,
} from "@medusajs/framework/types"
import { fulfillOrderNow } from "../../../../../lib/pos/fulfill"

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
//   5. Fulfil the order, because at a till the goods have already gone.
//
// Step 5 is what keeps stock honest. Placing an order only RESERVES stock;
// the physical count (stocked_quantity) does not move until a fulfillment
// exists. Online that gap is the days before dispatch. At a till there is
// no gap, so without this the reservation never closes and
// stocked_quantity keeps counting items the customer has already carried
// out of the shop. See src/lib/pos/fulfill.ts for the full reasoning.

type Body = { provider_id: string }

type FulfillOutcome = {
  fulfilled: boolean
  fulfillment_ids: string[]
  fulfillment_error: string | null
}

// Fulfil, but never at the cost of the sale.
//
// The money is captured by the time this runs. If fulfilling throws — a
// missing stock location, a shipping profile mismatch — the cashier must
// NOT see a failed request: they would retry and try to charge the customer
// a second time for goods already handed over. So this is best-effort, and
// the outcome is reported in the response body rather than as a status
// code. An unfulfilled order is a stock discrepancy someone can fix later;
// a double charge is a refund and an apology.
const fulfilBestEffort = async (
  req: AuthenticatedMedusaRequest<Body>,
  orderId: string
): Promise<FulfillOutcome> => {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  try {
    const result = await fulfillOrderNow(req.scope, orderId, {
      createdBy: req.auth_context.actor_id,
    })
    if (!result.fulfilled) {
      logger.warn(
        `[pos] order ${orderId} paid but not fulfilled: ${result.reason}`
      )
    }
    return {
      fulfilled: result.fulfilled,
      fulfillment_ids: result.fulfillment_ids,
      fulfillment_error: result.fulfilled ? null : result.reason ?? null,
    }
  } catch (err: any) {
    const message = err?.message ?? String(err)
    logger.error(
      `[pos] order ${orderId} was paid but could not be fulfilled: ${message}`
    )
    return { fulfilled: false, fulfillment_ids: [], fulfillment_error: message }
  }
}

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
    // Still try to fulfil. This is the path a retrying till takes, and
    // fulfillOrderNow subtracts what is already fulfilled, so a sale that
    // was paid but left unfulfilled gets repaired here instead of being
    // stuck forever behind an early return.
    return res.json({
      ok: true,
      already_captured: true,
      order_id,
      ...(await fulfilBestEffort(req, order_id)),
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
    // The till can surface this; stock is wrong until someone acts on it.
    ...(await fulfilBestEffort(req, order_id)),
  })
}
