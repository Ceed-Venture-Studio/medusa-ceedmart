import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fetchPaymentOptions } from "@medusajs/payment-pulse-pay"

// Which gateways checkout may offer (BRD §5.2 — the customer sees what they
// can actually use, not what happens to be registered).
//
// ── Why ask Pulse rather than decide here ───────────────────────────────
// Medusa's /store/payment-providers lists what is REGISTERED on the region.
// For Pulse that is one row, `pp_pulse-pay_pulse-pay`, and the real choice —
// Paystack, Monnify, Stripe — lives a level down, in whichever gateway the
// tenant has credentials for on the Pulse dashboard. Neither our config nor
// our database knows that; only Pulse does, and it changes without a deploy.
//
// Reimplementing the check from stored keys gets two things wrong that Pulse
// already handles: a credential can be storable but not chargeable, and the
// same store holds notification keys (mailgun, termii) that are not payment
// methods at all.
//
// ── Signed in only ──────────────────────────────────────────────────────
// The token is minted for a specific customer, and card payment already
// requires an account — a guest has no pim_id and cannot pay by card by
// design. Returning an empty list to a guest is therefore honest rather
// than a failure.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null

  if (!customerId) {
    res.json({ options: [], reason: "not_signed_in" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer",
    fields: ["id", "pim_id"],
    filters: { id: customerId },
  })

  const pimId = (data as any[])[0]?.pim_id
  if (!pimId) {
    // Registration with Pulse failed or was issued elsewhere. Recoverable —
    // `yarn backfill:pulse apply` repairs it — but for this request the
    // honest answer is that there is nothing this customer can pay with.
    logger.warn(
      `[payment-options] customer ${customerId} has no pim_id; cannot list gateways`
    )
    res.json({ options: [], reason: "no_pulse_identity" })
    return
  }

  const identityBaseUrl =
    process.env.PULSE_IDENTITY_BASE_URL ||
    "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1"
  const paymentBaseUrl =
    process.env.PULSE_PAYMENT_BASE_URL ||
    "https://pulse-pay-payment-enablement-service-218803590341.europe-west1.run.app/api/v1"

  const options = await fetchPaymentOptions(
    paymentBaseUrl,
    {
      identityBaseUrl,
      tenantId: process.env.PULSE_IDENTITY_TENANT_ID ?? "",
      applicationId: process.env.PULSE_IDENTITY_APP_ID ?? "",
      apiKey: process.env.PULSE_IDENTITY_API_KEY ?? "",
    },
    pimId
  )

  // null is a failed lookup, [] is "nothing configured". They need different
  // answers — one is temporary, the other needs an administrator — so the
  // distinction is preserved rather than collapsed into an empty list.
  if (options === null) {
    logger.error("[payment-options] could not reach Pulse to list gateways")
    res.status(502).json({ options: [], reason: "unavailable" })
    return
  }

  res.json({
    options,
    reason: options.length ? null : "none_configured",
  })
}
