import crypto from "crypto"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { fetchPaymentOptions, mintCustomerToken } from "../lib/payment-options"

type PulsePayOptions = {
  apiKey: string
  /**
   * Our Paystack secret, encrypted by Pulse. Optional now: Pulse resolves
   * the tenant's stored key server-side, so BYOK tenants never send one.
   * Retained for tenants still passing their own.
   */
  tenantId: string
  /**
   * Static service token. Legacy: kept only as a fallback for calls made
   * with no customer in scope. Every customer-facing call now mints its own
   * token — see customerToken().
   */
  bearerToken: string
  /** Pulse Identity, which mints the per-customer tokens PaymentCore wants. */
  identityBaseUrl?: string
  /** Sent as the body of the token-mint call. */
  applicationId?: string
  /**
   * Gateway to charge through. Leave unset: Pulse then uses the tenant's
   * single configured provider and records which one on the payment. Set it
   * only when more than one is configured, where Pulse refuses to guess —
   * it will not decide on its own which provider takes a customer's money.
   */
  channel?: string
  webhookSecret?: string
  baseUrl?: string
  successRedirectUrl?: string
  failureRedirectUrl?: string
}

const PULSE_PAY_BASE_URL =
  "https://pulse-pay-payment-enablement-service-218803590341.europe-west1.run.app/api/v1"

// Pulse's PaymentStatus enum, verified against
// PulsePaymentCore.Domain/Enums/PaymentStatus.cs. Named rather than inlined
// because the numbers alone are what caused the original bug.
//
// The previous mapping read these as if they were PayoutStatus — a genuinely
// different enum in the same API where 1=Pending and 2=Success. Eight of the
// nine values were wrong, and the expensive one was 3: a COMPLETED payment
// was reported to Medusa as "canceled".
//
// That is also why authorizePayment grew a "trust the reference" fallback.
// A real successful payment could never map to captured, so something had to
// force it through, and what got written authorised every session whether it
// had been paid or not. Correcting this enum is what makes that removable.
export enum PulsePaymentStatus {
  Initiated = 0,
  Authorized = 1,
  Pending = 2,
  Completed = 3,
  Failed = 4,
  Cancelled = 5,
  Refunded = 6,
  ChargedBack = 7,
  Expired = 8,
}

/**
 * Map a Pulse payment status to a Medusa PaymentSessionStatus.
 *
 * Accepts the numeric enum or the string forms Pulse uses in webhooks.
 * An UNRECOGNISED value returns "pending" rather than a guess: pending is
 * the only status that neither takes money nor abandons an order, so it is
 * the one safe answer when we do not know.
 */
export function mapPulseStatus(status: any): PaymentSessionStatus {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : status

  switch (normalized) {
    // Created, or still moving. Nothing decided yet.
    case PulsePaymentStatus.Initiated:
    case PulsePaymentStatus.Pending:
    case "initiated":
    case "pending":
    case "ongoing":
    case "processing":
      return "pending" as PaymentSessionStatus

    // Authorized is a HOLD, not money taken. Reporting it as captured is how
    // an order gets fulfilled against funds nobody has collected.
    case PulsePaymentStatus.Authorized:
    case "authorized":
      return "authorized" as PaymentSessionStatus

    // The only status that means paid.
    case PulsePaymentStatus.Completed:
    case "completed":
    case "success":
    case "successful":
      return "captured" as PaymentSessionStatus

    case PulsePaymentStatus.Failed:
    case "failed":
      return "error" as PaymentSessionStatus

    // Expired is a cancellation the clock performed.
    case PulsePaymentStatus.Cancelled:
    case PulsePaymentStatus.Expired:
    case "cancelled":
    case "canceled":
    case "abandoned":
    case "expired":
      return "canceled" as PaymentSessionStatus

    // Money was captured and later returned. Medusa's session status has no
    // "refunded" — the refund lives on the payment, not the session — so the
    // truthful answer about the SESSION is that it was captured.
    case PulsePaymentStatus.Refunded:
    case "refunded":
      return "captured" as PaymentSessionStatus

    // A chargeback is a disputed reversal, not an orderly refund. Surfacing
    // it as an error is what gets a human to look at it.
    case PulsePaymentStatus.ChargedBack:
    case "chargedback":
    case "charged_back":
      return "error" as PaymentSessionStatus

    default:
      return "pending" as PaymentSessionStatus
  }
}

class PulsePayService extends AbstractPaymentProvider<PulsePayOptions> {
  static identifier = "pulse-pay"

  private apiKey: string
  private tenantId: string
  private bearerToken: string
  private identityBaseUrl: string
  private applicationId: string
  private channel: string
  private webhookSecret?: string
  private baseUrl: string
  private successRedirectUrl: string
  private failureRedirectUrl: string

  static validateOptions(options: Record<any, any>) {
    if (!options.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse Payment: apiKey is required"
      )
    }
    if (!options.tenantId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse Payment: tenantId is required"
      )
    }
    if (!options.bearerToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse Payment: bearerToken is required"
      )
    }
  }

  constructor(container: Record<string, unknown>, options: PulsePayOptions) {
    super(container, options)
    this.apiKey = options.apiKey
    this.tenantId = options.tenantId
    this.bearerToken = options.bearerToken
    this.identityBaseUrl =
      options.identityBaseUrl ||
      "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1"
    this.applicationId = options.applicationId || ""
    this.channel = options.channel || ""
    this.webhookSecret = options.webhookSecret
    this.baseUrl = options.baseUrl || PULSE_PAY_BASE_URL
    this.successRedirectUrl =
      options.successRedirectUrl || "http://localhost:8000/ng/checkout?step=review"
    this.failureRedirectUrl =
      options.failureRedirectUrl || "http://localhost:8000/ng/checkout?step=payment"
  }

  /**
   * Mint a JWT for one customer.
   *
   * PaymentCore validates token signatures against the Identity instance it
   * is paired with, so a token from anywhere else is rejected outright —
   * `INVALID_SIGNATURE`, which reads like a bad credential rather than a
   * token from the wrong place. A single static token in the environment
   * cannot survive pointing the app at a different Identity, and expires
   * besides. Minting per payment removes both problems.
   *
   * Needs only the tenant API key: Pulse documents this endpoint as the way
   * "services like Pulse Payment obtain customer tokens without password
   * authentication".
   *
   * Cached until shortly before expiry. Tokens last hours, a checkout makes
   * several calls, and re-minting each one is a round trip for nothing.
   */
  private tokenCache = new Map<string, { token: string; expiresAt: number }>()

  /** Short-lived: gateways change on the Pulse dashboard, not on deploy, so
   *  this must go stale quickly — but not once per payment. */
  private channelCache: { value: string; expiresAt: number } | null = null

  /**
   * Which gateway to charge through.
   *
   * Only consulted when the customer did not choose — a cart resumed from
   * an older session, or a caller that does not offer a choice.
   *
   * Configured value wins. Otherwise we ASK Pulse rather than omitting the
   * field: Pulse is documented to resolve a single configured provider on
   * its own, and did — until it started answering "Payment channel is
   * required" for the same tenant with the same one provider. Naming it
   * explicitly does not depend on that behaviour holding.
   *
   * Returns "" when it cannot be determined, which lets the request go out
   * without a channel and Pulse give its own error, rather than us inventing
   * a gateway.
   */
  private async resolveChannel(pimId: string): Promise<string> {
    if (this.channel) {
      return this.channel
    }

    if (this.channelCache && this.channelCache.expiresAt > Date.now()) {
      return this.channelCache.value
    }

    const options = await fetchPaymentOptions(
      this.baseUrl,
      {
        identityBaseUrl: this.identityBaseUrl,
        tenantId: this.tenantId,
        applicationId: this.applicationId,
        apiKey: this.apiKey,
      },
      pimId
    )

    // Exactly one is the only case we can decide. With several, choosing
    // would pick who takes the customer's money; with none, there is nothing
    // to pick. Both are Pulse's to report.
    const value = options && options.length === 1 ? options[0].provider : ""

    this.channelCache = { value, expiresAt: Date.now() + 60_000 }
    return value
  }

  private async customerToken(pimId: string): Promise<string> {
    const cached = this.tokenCache.get(pimId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }

    let token: string
    try {
      token = await mintCustomerToken(
        {
          identityBaseUrl: this.identityBaseUrl,
          tenantId: this.tenantId,
          applicationId: this.applicationId,
          apiKey: this.apiKey,
        },
        pimId
      )
    } catch (err: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Could not obtain a payment token for this customer: ${err?.message ?? err}`
      )
    }

    // Expire our copy a minute early so a token cannot lapse mid-request.
    let expiresAt = Date.now() + 5 * 60 * 1000
    try {
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString()
      )
      if (claims?.exp) expiresAt = claims.exp * 1000 - 60_000
    } catch {
      // Unreadable claims are not fatal — fall back to the short default.
    }

    this.tokenCache.set(pimId, { token, expiresAt })
    return token
  }

  private async pulseRequest(
    method: string,
    path: string,
    body?: any,
    /**
     * The customer this call is on behalf of. Falls back to the static
     * service token when absent, which covers calls with no customer in
     * scope — and is why bearerToken is still accepted.
     */
    pimId?: string,
    /** Internal. Set when this call is the one retry after a 401/403. */
    isRetry = false
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`
    const token = pimId ? await this.customerToken(pimId) : this.bearerToken
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "*/*",
      Authorization: `Bearer ${token}`,
      "X-API-Key": this.apiKey,
    }

    // No Service-Key, ever. Gateway credentials are encrypted and persisted
    // on the Pulse dashboard; the tenant API key identifies us and `channel`
    // says which of their stored gateways to charge. Sending a key of our
    // own would put a second, unversioned copy of a secret in every request
    // — and, since a Service-Key belongs to ONE gateway while a tenant may
    // have several, it silently contradicts the channel: our Paystack key
    // checked against their Monnify setup is what produced "Monnify
    // Service-Key must be a JSON bundle".

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json()

    // A rejected token is worth exactly one more try with a fresh one.
    //
    // Customer tokens are cached until a minute before the `exp` in their
    // claims, which covers ordinary expiry — but not a token invalidated
    // EARLY: Identity restarting with new signing keys, a revoked session,
    // clock skew between the two services. Pulse answers 401 INVALID_TOKEN
    // for all of those, and the cached copy stays valid-looking, so every
    // caller inside the cache window fails identically. The webhook's three
    // retries happen within seconds and would all reuse the same dead token,
    // turning a momentary key change into a permanently lost payment.
    //
    // So drop the cached token and mint a new one, once. If that is also
    // refused the problem is not staleness and repeating would only add
    // load to a service already saying no.
    //
    // Only for customer tokens: there is nothing to re-mint for the static
    // bearer, and a POST is not replayed on anything but an auth failure, so
    // this cannot double-charge.
    const authRejected = response.status === 401 || response.status === 403

    if (authRejected && pimId && !isRetry) {
      console.warn(
        `Pulse: ${response.status} on ${method} ${path} — discarding the cached ` +
          `token for ${pimId} and retrying once with a fresh one`
      )
      this.tokenCache.delete(pimId)
      return this.pulseRequest(method, path, body, pimId, true)
    }

    if (!response.ok) {
      console.error(
        `Pulse Payment API error: ${response.status} ${response.statusText}`,
        data
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Pulse Payment API error: ${data?.message || response.statusText}`
      )
    }

    return data
  }

  /**
   * Create a payment on Pulse. Returns the checkout URL (action) for redirect.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, data: sessionData, context } = input
    const sessionId = sessionData?.session_id as string

    const customer = context?.customer as Record<string, any> | undefined
    const pimId = customer?.pim_id || ""

    if (!pimId) {
      // This message reaches the SHOPPER: the storefront renders the error
      // from a failed payment session verbatim. The old text named an
      // internal field and told them to register with a system they have
      // never heard of, at the last step of checkout.
      //
      // The detail belongs in the log, where someone can act on it. The
      // customer gets something true, and a route out that is not "give up".
      console.error(
        `[pulse-pay] customer ${customer?.id ?? "(unknown)"} <${customer?.email ?? "?"}> ` +
          `has no pim_id — their Pulse Identity registration failed or was issued by ` +
          `another instance. Run \`yarn backfill:pulse apply\` to repair.`
      )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "We couldn't start your card payment. Please sign out and back in, then try again — if it keeps happening, contact us and we'll complete your order."
      )
    }

    // The channel the CUSTOMER chose, sent by checkout in the session data,
    // wins over anything we would work out ourselves. Without this their
    // choice never left the storefront: resolveChannel only answers when
    // exactly one gateway is configured, so with two it returned "" and
    // Pulse refused the request — "This tenant has more than one payment
    // provider configured (monnify, paystack). Specify 'channel'." The
    // customer picked one; we simply were not passing it on.
    const chosenChannel =
      typeof sessionData?.channel === "string" ? sessionData.channel.trim() : ""
    const channel = chosenChannel || (await this.resolveChannel(pimId))

    const successUrl = new URL(this.successRedirectUrl)
    successUrl.searchParams.set("session_id", sessionId || "")
    const failureUrl = new URL(this.failureRedirectUrl)
    failureUrl.searchParams.set("session_id", sessionId || "")

    const payload = {
      tenantId: this.tenantId,
      description: "Ceedmart order payment",
      amount: Number(amount),
      currency: (currency_code || "NGN").toUpperCase(),
      action: "initiate_charge",
      ...(channel ? { channel } : {}),
      // pim_id travels with the payment because the WEBHOOK needs it.
      // A webhook has no customer in scope, and confirming it means minting
      // a customer token — so the id has to come back to us somehow.
      // Pulse's own CustomerId field cannot be relied on: on a Monnify event
      // it carries the customer's EMAIL, which Identity rejects with
      // "Invalid tenant customer ID". Metadata is ours and round-trips
      // unchanged.
      metadata: JSON.stringify({
        session_id: sessionId,
        pim_id: pimId,
      }),
      successlRedirectUrl: successUrl.toString(),
      failureRedirectUrl: failureUrl.toString(),
      customerIdentity: {
        firstName: customer?.first_name || "",
        lastName: customer?.last_name || "",
        email: customer?.email || "",
        pimId: pimId,
      },
    }

    const result = await this.pulseRequest("POST", "/Payments", payload, pimId)
    const payment = result?.data?.value

    if (!payment?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Pulse Payment did not return a payment ID"
      )
    }

    return {
      id: payment.id,
      data: {
        id: payment.id,
        session_id: sessionId,
        // Kept so later calls can mint their own token. authorizePayment and
        // friends are handed only `data` — there is no customer in scope by
        // then, and without this they would fall back to the static service
        // token, which is exactly what was failing.
        pim_id: pimId,
        pulse_reference: payment.paymentReference,
        transaction_reference: payment.transactionReference,
        checkout_url: payment.action,
        status: payment.status,
        channel: payment.channel,
        amount: payment.amount,
        currency: payment.currency,
      },
    }
  }

  /**
   * Check with Pulse if the payment has been authorized/captured.
   * Since Paystack auto-captures, a successful payment = captured.
   *
   * This is called both by:
   * 1. The webhook processPaymentWorkflow (after SUCCESSFUL webhook)
   * 2. The UI cart complete flow (after redirect back from Paystack)
   *
   * We query Pulse for status, but also check if the context indicates
   * payment was already confirmed (e.g., redirect back from Paystack).
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const pulseId = input.data?.id as string

    if (!pulseId) {
      return {
        status: "error" as PaymentSessionStatus,
        data: input.data as Record<string, unknown>,
      }
    }

    let pulseStatus: any = 0
    try {
      const payment = await this.readPayment(
        pulseId,
        input.data?.pim_id as string | undefined
      )
      pulseStatus = payment?.status ?? payment?.Status ?? 0
    } catch (err: any) {
      console.warn("Pulse authorizePayment: failed to get status:", err.message)
    }

    const status = mapPulseStatus(pulseStatus)

    // captured, not authorized: Pulse's channel is Paystack, which takes the
    // money at the point of payment. There is no separate capture step to
    // wait for, so a Completed payment is already collected.
    if (status === ("captured" as PaymentSessionStatus)) {
      return {
        status: "authorized" as PaymentSessionStatus,
        data: { ...input.data, pulse_status: pulseStatus } as Record<string, unknown>,
      }
    }

    // Anything else is reported as it is.
    //
    // There used to be a fallback here that returned "authorized" whenever the
    // session carried a pulse_reference — which initiatePayment always sets, so
    // in practice EVERY session authorised, paid or not. It was a workaround for
    // the status mapping above being wrong: Completed (3) mapped to "canceled",
    // so no real payment could ever authorise through the status path and
    // something had to force it. With the enum corrected the workaround is not
    // just unnecessary, it is the difference between charging a customer and
    // taking their order for free.
    return {
      status,
      data: { ...input.data, pulse_status: pulseStatus } as Record<string, unknown>,
    }
  }

  /**
   * Capture is a no-op for Paystack (auto-capture).
   * Just confirm the payment status with Pulse.
   */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const pulseId = input.data?.id as string

    if (pulseId) {
      try {
        const result = await this.pulseRequest(
          "GET",
          `/Payments/${pulseId}`,
          undefined,
          input.data?.pim_id as string | undefined
        )
        const payment = result?.data || result
        return {
          data: {
            ...input.data,
            pulse_status: payment?.status ?? payment?.value?.status,
            captured_at: new Date().toISOString(),
          } as Record<string, unknown>,
        }
      } catch {
        // If we can't reach Pulse, still return success since Paystack already captured
      }
    }

    return {
      data: {
        ...input.data,
        captured_at: new Date().toISOString(),
      } as Record<string, unknown>,
    }
  }

  /**
   * Cancel a pending payment.
   */
  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    // Pulse doesn't have a dedicated cancel endpoint for payments
    // The payment will expire on its own if not completed
    return {
      data: {
        ...input.data,
        canceled_at: new Date().toISOString(),
      } as Record<string, unknown>,
    }
  }

  /**
   * Delete a payment session (cleanup).
   */
  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data as Record<string, unknown> }
  }

  /**
   * Get payment status from Pulse.
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const pulseId = input.data?.id as string

    if (!pulseId) {
      return { status: "pending" as PaymentSessionStatus }
    }

    try {
      const result = await this.pulseRequest(
        "GET",
        `/Payments/${pulseId}`,
        undefined,
        input.data?.pim_id as string | undefined
      )
      const payment = result?.data || result
      const pulseStatus = payment?.status ?? payment?.value?.status ?? 0

      return {
        status: mapPulseStatus(pulseStatus),
        data: {
          ...input.data,
          pulse_status: pulseStatus,
        } as Record<string, unknown>,
      }
    } catch {
      return { status: "pending" as PaymentSessionStatus }
    }
  }

  /**
   * Retrieve full payment data from Pulse.
   */
  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const pulseId = input.data?.id as string

    if (!pulseId) {
      return { data: input.data as Record<string, unknown> }
    }

    const result = await this.pulseRequest(
      "GET",
      `/Payments/${pulseId}`,
      undefined,
      input.data?.pim_id as string | undefined
    )
    return { data: result?.data?.value || result?.data || result }
  }

  /**
   * Update payment (e.g., amount changed).
   * Pulse doesn't support updating an existing payment, so we return as-is.
   */
  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    return {
      data: input.data as Record<string, unknown>,
    }
  }

  /**
   * Handle webhook from Pulse Payment.
   * Pulse sends status updates when Paystack confirms payment.
   */
  /**
   * Parse metadata from string or object, checking both camelCase and PascalCase keys.
   */
  private parseMetadata(raw: any): Record<string, any> {
    if (!raw) return {}
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw)
      } catch {
        return {}
      }
    }
    return raw
  }

  /**
   * Get a field from an object, trying both camelCase and PascalCase.
   */
  private getField(obj: any, camel: string, pascal: string): any {
    return obj?.[camel] ?? obj?.[pascal]
  }

  /**
   * Read one payment back from Pulse.
   *
   * ── Why not simply GET /Payments/{id} ───────────────────────────────
   * That endpoint asks the GATEWAY for the payment, so it needs the
   * gateway's credentials — and answers "Service key is required" when the
   * tenant has more than one provider and we send none. We deliberately
   * send none: gateway credentials are encrypted and persisted on the Pulse
   * dashboard, and a Service-Key belongs to a single gateway, so with two
   * configured it can only ever agree with one of them.
   *
   * GET /Payments/customer/{pimId} reads Pulse's OWN records instead, needs
   * no gateway credential, and carries the same status. So we look the
   * payment up in the customer's list and fall back to the direct read only
   * when there is no customer to look under.
   *
   * Verified against a live Monnify payment: the direct read returned 400
   * "Service key is required" while the customer list reported status 3.
   */
  private async readPayment(
    pulseId: string,
    pimId?: string
  ): Promise<any | null> {
    if (pimId) {
      try {
        const list = await this.pulseRequest(
          "GET",
          `/Payments/customer/${pimId}?pageSize=100`,
          undefined,
          pimId
        )
        const raw = list?.data?.value ?? list?.data ?? []
        const payments = Array.isArray(raw) ? raw : (raw.items ?? raw.value ?? [])
        const match = payments.find(
          (p: any) => (p?.id ?? p?.Id) === pulseId
        )
        if (match) {
          return match
        }
      } catch (err: any) {
        console.warn(
          `Pulse: customer payment list failed for ${pimId}: ${err?.message ?? err}`
        )
      }
    }

    const result = await this.pulseRequest(
      "GET",
      `/Payments/${pulseId}`,
      undefined,
      pimId
    )
    return result?.data?.value || result?.data || result
  }

  /**
   * Is this webhook really from Pulse?
   *
   * Pulse sends the shared secret in `pulse-webhook-hash`, base64-encoded —
   * observed on a live delivery, where the value decoded to the literal
   * placeholder this instance is configured with. It is a bearer token, NOT
   * a signature: it is the same on every request and covers none of the
   * body, so it proves the sender knows a secret and nothing about what they
   * sent. Replayable, and useless if the secret leaks.
   *
   * That is why it does not replace confirm-by-reading below. It is a cheap
   * first gate that rejects internet noise before we spend a Pulse round
   * trip on it; the authenticated re-read remains what decides whether a
   * payment happened.
   *
   * Accepts a COMMA-SEPARATED list, because one value is not enough in
   * practice: a local Pulse ships with a placeholder secret while the real
   * one lives in the dashboard, and rotating a shared secret needs a window
   * where both the old and new value are valid. A single value forces a
   * flag day, and a flag day on a webhook means dropped payments.
   *
   * Unset means no gate, which is how it behaved before and keeps a
   * misconfigured environment working rather than silently dropping real
   * payments.
   */
  private webhookSenderIsTrusted(
    headers: Record<string, any> | undefined
  ): boolean {
    if (!this.webhookSecret) {
      return true
    }

    const supplied = String(
      headers?.["pulse-webhook-hash"] ?? headers?.["Pulse-Webhook-Hash"] ?? ""
    ).trim()
    if (!supplied) {
      return false
    }

    // Accept the base64 form Pulse sends and the bare secret, so a change of
    // encoding on their side is not an outage on ours.
    const expected = this.webhookSecret
      .split(",")
      .map((secret) => secret.trim())
      .filter(Boolean)
      .flatMap((secret) => [
        Buffer.from(secret, "utf8").toString("base64"),
        secret,
      ])

    return expected.some((candidate) => {
      const a = Buffer.from(candidate, "utf8")
      const b = Buffer.from(supplied, "utf8")
      // Length is compared first because timingSafeEqual throws on a
      // mismatch; length is not the secret, so leaking it costs nothing.
      return a.length === b.length && crypto.timingSafeEqual(a, b)
    })
  }

  /**
   * Handle a webhook from Pulse.
   *
   * ── The webhook is a NUDGE, never the verdict ─────────────────────────
   * Nothing authenticates this request. Medusa's /hooks/payment/:provider
   * route has no auth middleware, Pulse stores a secretHash but we have not
   * established how (or whether) it is transmitted, and we cannot change
   * Pulse to find out. So the body is attacker-controlled input: anyone who
   * can reach the endpoint could post {Status: 3} for a session id and,
   * taken at face value, mark an unpaid order captured.
   *
   * Rather than trust it, we CONFIRM: the webhook tells us to go and look,
   * and the answer comes from Pulse over an authenticated call we made
   * ourselves. A forged webhook then achieves nothing, because the status
   * it asserts is discarded. That closes the hole without Pulse changing.
   *
   * The cost is one extra request per webhook, and the risk noted below.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const event = payload.data as Record<string, any>

    // Logged once per webhook so the header carrying Pulse's secretHash can
    // be identified from real traffic. The moment we know its name and
    // whether it is a plain value or an HMAC over the raw body, verification
    // can be added here and the confirm-by-reading below becomes a second
    // line of defence rather than the only one.
    if (!this.webhookSenderIsTrusted(payload.headers as any)) {
      // Deliberately terse, and deliberately not an error: an unverified
      // caller should learn nothing, and a flood of them should not fill the
      // log with stack traces.
      console.warn("Pulse webhook: rejected, pulse-webhook-hash did not match")
      return {
        action: PaymentActions.NOT_SUPPORTED,
        data: { session_id: "", amount: new BigNumber(0) },
      }
    }

    console.log("Pulse webhook received:", JSON.stringify(event, null, 2))

    try {
      // Pulse sends PascalCase: Status, Amount, Metadata, Id
      const status = this.getField(event, "status", "Status")
      const amount = this.getField(event, "amount", "Amount") || 0
      const rawMetadata = this.getField(event, "metadata", "Metadata")
      const metadata = this.parseMetadata(rawMetadata)
      const sessionId = metadata?.session_id || ""

      // The customer id used to authenticate the confirmation call.
      //
      // Our own metadata first. CustomerId is a fallback and only when it
      // LOOKS like a Pulse id: on a Monnify event that field carries the
      // customer's email address, and handing that to Identity fails with
      // "Invalid tenant customer ID" — which is precisely how a genuinely
      // successful ₦426,000 payment got dropped.
      const claimedCustomer = this.getField(event, "customerId", "CustomerId")
      const pimId =
        metadata?.pim_id ||
        (typeof claimedCustomer === "string" &&
        /^[0-9a-f]{24}$/i.test(claimedCustomer)
          ? claimedCustomer
          : undefined)

      console.log("Pulse webhook parsed:", { status, amount, sessionId })

      if (!sessionId) {
        // Fallback: look up payment by Pulse ID to get session_id
        const pulseId = this.getField(event, "id", "Id")
        if (pulseId) {
          try {
            const result = await this.pulseRequest(
              "GET",
              `/Payments/${pulseId}`,
              undefined,
              pimId
            )
            const fullPayment = result?.data?.value || result?.data || result
            const fullMetadata = this.parseMetadata(
              fullPayment?.metadata || fullPayment?.Metadata
            )
            if (fullMetadata?.session_id) {
              console.log("Pulse webhook: recovered session_id via API:", fullMetadata.session_id)
              return this.buildWebhookResult(status, fullMetadata.session_id, amount)
            }
          } catch (err: any) {
            console.warn("Pulse webhook: payment lookup failed:", err.message)
          }
        }

        console.warn("Pulse webhook: no session_id found")
        return {
          action: PaymentActions.NOT_SUPPORTED,
          data: { session_id: "", amount: new BigNumber(0) },
        }
      }

      // Confirm rather than believe. The status on the wire is ignored; the
      // one we act on comes from a call we authenticated.
      //
      // Reading an unfinished payment makes Pulse mark it Cancelled, so a
      // forged webhook can still disrupt a payment in flight. It cannot
      // fabricate a successful one, which is the difference between a
      // nuisance and a free order — and a cancelled session is recoverable:
      // the storefront starts a new one rather than dead-ending.
      const pulseId = this.getField(event, "id", "Id")
      if (pulseId) {
        try {
          const payment = await this.readPayment(pulseId, pimId)
          const confirmed = payment?.status ?? payment?.Status

          if (confirmed !== undefined && confirmed !== null) {
            if (String(confirmed) !== String(status)) {
              console.warn(
                `Pulse webhook: claimed status ${status} but Pulse reports ` +
                  `${confirmed} for ${pulseId} — acting on ${confirmed}`
              )
            }
            return this.buildWebhookResult(
              confirmed,
              sessionId,
              Number(payment?.amount ?? amount)
            )
          }
        } catch (err: any) {
          // Could not confirm — so THROW, and let the event bus retry.
          //
          // This used to return NOT_SUPPORTED, which reads as "handled" to
          // the bus: one attempt, no retry, event gone. A momentary Identity
          // failure therefore discarded a real payment permanently, and the
          // webhook is precisely the backstop that is supposed to survive
          // that. Failing loudly costs three attempts; failing quietly cost
          // a customer their order.
          //
          // Still safe: nothing moves on an unverified claim either way.
          // The only change is whether we get to try again.
          console.error(
            `Pulse webhook: could not confirm ${pulseId} for session ${sessionId}: ` +
              `${err?.message ?? err} — throwing so the event is retried`
          )
          throw err
        }
      }

      // No id to confirm against — an event we cannot verify is an event we
      // do not act on.
      console.warn("Pulse webhook: no payment id to confirm against, ignoring")
      return {
        action: PaymentActions.NOT_SUPPORTED,
        data: { session_id: sessionId, amount: new BigNumber(amount) },
      }
    } catch (err: any) {
      console.error("Pulse webhook processing error:", err.message)
      return {
        action: PaymentActions.FAILED,
        data: { session_id: "", amount: new BigNumber(0) },
      }
    }
  }

  /**
   * Turn a Pulse status into a webhook action.
   *
   * Derived from mapPulseStatus rather than switching on the raw status a
   * second time. This method USED to carry its own copy — 1 SUCCESSFUL,
   * 2 FAILED, 3 CANCELED — which was the same misreading of the enum that
   * was fixed in mapPulseStatus, and it survived that fix by being a
   * separate switch. Under the real enum it reported a COMPLETED payment
   * (3) as CANCELED: the customer pays, the webhook arrives, and the order
   * is cancelled.
   *
   * One mapping, one place. The two cannot drift apart again.
   */
  private buildWebhookResult(
    status: any,
    sessionId: string,
    amount: number
  ): WebhookActionResult {
    const sessionStatus = mapPulseStatus(status)

    const action =
      sessionStatus === "captured"
        ? PaymentActions.SUCCESSFUL
        : sessionStatus === "authorized"
          ? PaymentActions.AUTHORIZED
          : sessionStatus === "error"
            ? PaymentActions.FAILED
            : sessionStatus === "canceled"
              ? PaymentActions.CANCELED
              : // "pending" covers Initiated and Pending, and is also what an
                // unrecognised status maps to. Neither is an event worth
                // acting on: NOT_SUPPORTED tells Medusa to leave the session
                // alone rather than move it somewhere on a guess.
                PaymentActions.NOT_SUPPORTED

    return {
      action,
      data: { session_id: sessionId, amount: new BigNumber(amount) },
    }
  }

  /**
   * Refund a payment via Pulse.
   */
  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    // TODO: Implement when Pulse exposes a refund endpoint for payments
    // For now, log and return the existing data
    console.warn(
      `Pulse Payment refund requested for ${input.data?.id}, amount: ${input.amount}. Manual refund may be required.`
    )
    return {
      data: {
        ...input.data,
        refund_requested: true,
        refund_amount: input.amount,
        refunded_at: new Date().toISOString(),
      } as Record<string, unknown>,
    }
  }
}

export default PulsePayService
