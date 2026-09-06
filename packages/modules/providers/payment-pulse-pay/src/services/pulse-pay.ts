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

type PulsePayOptions = {
  apiKey: string
  serviceKey: string
  tenantId: string
  bearerToken: string
  channel?: string
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
  private serviceKey: string
  private tenantId: string
  private bearerToken: string
  private channel: string
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
    if (!options.serviceKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pulse Payment: serviceKey is required"
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
    this.serviceKey = options.serviceKey
    this.tenantId = options.tenantId
    this.bearerToken = options.bearerToken
    this.channel = options.channel || "paystack"
    this.baseUrl = options.baseUrl || PULSE_PAY_BASE_URL
    this.successRedirectUrl =
      options.successRedirectUrl || "http://localhost:8000/ng/checkout?step=review"
    this.failureRedirectUrl =
      options.failureRedirectUrl || "http://localhost:8000/ng/checkout?step=payment"
  }

  private async pulseRequest(
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "*/*",
      Authorization: `Bearer ${this.bearerToken}`,
      "Service-Key": this.serviceKey,
      "X-API-Key": this.apiKey,
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json()

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
      channel: this.channel,
      metadata: JSON.stringify({
        session_id: sessionId,
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

    const result = await this.pulseRequest("POST", "/Payments", payload)
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
      const result = await this.pulseRequest("GET", `/Payments/${pulseId}`)
      const payment = result?.data?.value || result?.data || result
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
        const result = await this.pulseRequest("GET", `/Payments/${pulseId}`)
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
      const result = await this.pulseRequest("GET", `/Payments/${pulseId}`)
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

    const result = await this.pulseRequest("GET", `/Payments/${pulseId}`)
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

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const event = payload.data as Record<string, any>

    console.log("Pulse webhook received:", JSON.stringify(event, null, 2))

    try {
      // Pulse sends PascalCase: Status, Amount, Metadata, Id
      const status = this.getField(event, "status", "Status")
      const amount = this.getField(event, "amount", "Amount") || 0
      const rawMetadata = this.getField(event, "metadata", "Metadata")
      const metadata = this.parseMetadata(rawMetadata)
      const sessionId = metadata?.session_id || ""

      console.log("Pulse webhook parsed:", { status, amount, sessionId })

      if (!sessionId) {
        // Fallback: look up payment by Pulse ID to get session_id
        const pulseId = this.getField(event, "id", "Id")
        if (pulseId) {
          try {
            const result = await this.pulseRequest("GET", `/Payments/${pulseId}`)
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

      return this.buildWebhookResult(status, sessionId, amount)
    } catch (err: any) {
      console.error("Pulse webhook processing error:", err.message)
      return {
        action: PaymentActions.FAILED,
        data: { session_id: "", amount: new BigNumber(0) },
      }
    }
  }

  private buildWebhookResult(
    status: any,
    sessionId: string,
    amount: number
  ): WebhookActionResult {
    // Pulse sends status as string ("success", "failed") or number (0, 1, 2, 3)
    const normalized = typeof status === "string" ? status.toLowerCase() : status

    switch (normalized) {
      case "success":
      case 1:
        return {
          action: PaymentActions.SUCCESSFUL,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
      case "failed":
      case 2:
        return {
          action: PaymentActions.FAILED,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
      case "cancelled":
      case "canceled":
      case 3:
        return {
          action: PaymentActions.CANCELED,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
      default:
        return {
          action: PaymentActions.NOT_SUPPORTED,
          data: { session_id: sessionId, amount: new BigNumber(amount) },
        }
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
