import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fetchPaymentStatus } from "@medusajs/payment-pulse-pay"

// Has this cart actually been paid for?
//
// ── Why the session's own status is not the answer ──────────────────────
// A Medusa payment session only turns `authorized` once something confirms
// it — the webhook, or place-order. Between the customer paying and that
// confirmation arriving, the session still reads `pending` while the money
// is already gone. Anything that treats `pending` as "not paid" during that
// window is wrong, and one thing did: revisiting the payment step calls
// createPaymentSessions, which DELETES the existing session. Two genuinely
// completed payments were orphaned that way, each abandoned by the next
// attempt before its confirmation landed.
//
// So this asks Pulse directly, and the checkout asks this before it
// replaces anything.
//
// ── Status 3 is Completed ───────────────────────────────────────────────
// Pulse's enum, not ours. Mapped here rather than exported so callers deal
// in "paid" and never in a magic number.

const PULSE_COMPLETED = 3

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id },
  })

  const sessions =
    (data as any[])[0]?.payment_collection?.payment_sessions ?? []
  // The newest session is the one in play; older ones are abandoned attempts.
  const session = sessions[sessions.length - 1]

  if (!session) {
    res.json({ paid: false, reason: "no_session", session_status: null })
    return
  }

  // Already confirmed — no need to trouble Pulse.
  if (session.status === "authorized" || session.status === "captured") {
    res.json({ paid: true, reason: null, session_status: session.status })
    return
  }

  const pulseId = session.data?.id as string | undefined
  const pimId = session.data?.pim_id as string | undefined

  if (!pulseId || !pimId) {
    res.json({
      paid: false,
      reason: "not_a_pulse_session",
      session_status: session.status,
    })
    return
  }

  const status = await fetchPaymentStatus(
    process.env.PULSE_PAYMENT_BASE_URL ||
      "https://pulse-pay-payment-enablement-service-218803590341.europe-west1.run.app/api/v1",
    {
      identityBaseUrl:
        process.env.PULSE_IDENTITY_BASE_URL ||
        "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1",
      tenantId: process.env.PULSE_IDENTITY_TENANT_ID ?? "",
      applicationId: process.env.PULSE_IDENTITY_APP_ID ?? "",
      apiKey: process.env.PULSE_IDENTITY_API_KEY ?? "",
    },
    pimId,
    pulseId
  )

  if (status === null) {
    // Unknown, NOT unpaid. The caller must not discard a session on this.
    logger.warn(
      `[payment-status] could not read Pulse status for ${pulseId}; reporting unknown`
    )
    res.json({
      paid: false,
      reason: "unknown",
      session_status: session.status,
    })
    return
  }

  res.json({
    paid: status === PULSE_COMPLETED,
    reason: null,
    session_status: session.status,
    pulse_status: status,
  })
}
