// Which gateways this tenant can actually charge with.
//
// Pulse answers that question directly, and the answer is not the same as
// "which providers have a stored key": a credential can be storable but not
// chargeable, and the same table holds notification keys — mailgun, termii —
// which are not payment methods at all. Asking Pulse avoids reimplementing a
// filter whose edge cases we would get wrong.
//
// Lives outside the service so an API route can call it without standing up
// a payment provider, and shares mintCustomerToken with the service so there
// is one definition of how a token is obtained.

export type PulseTokenConfig = {
  identityBaseUrl: string
  tenantId: string
  applicationId: string
  apiKey: string
}

export type PulsePaymentOption = {
  /** Lowercase key. This is what goes in `channel` when creating a payment. */
  provider: string
  /** Ready to render. Deliberately not mapped to our own labels: Pulse owns
   *  the naming, and a local map goes stale the moment they add a gateway. */
  displayName: string
  /** false means a test key. Worth surfacing — a shop that has quietly been
   *  on test credentials looks exactly like one that is taking money. */
  isLive: boolean
}

/**
 * Mint a JWT for one customer.
 *
 * Needs only the tenant API key. Pulse documents this as how "services like
 * Pulse Payment obtain customer tokens without password authentication".
 */
export const mintCustomerToken = async (
  config: PulseTokenConfig,
  pimId: string
): Promise<string> => {
  const url = `${config.identityBaseUrl}/tenants/${config.tenantId}/customers/${pimId}/token`

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
    body: JSON.stringify({ applicationId: config.applicationId }),
  })

  const data: any = await response.json().catch(() => ({}))
  const token = data?.payload?.value?.token || data?.data?.token

  if (!response.ok || !token) {
    throw new Error(
      `Pulse Identity did not return a customer token: ${
        data?.error?.message || response.statusText
      }`
    )
  }

  return token
}

/**
 * List the gateways this tenant can charge with.
 *
 * An EMPTY list is a valid answer — it means nothing is configured, not that
 * the call failed. Callers must tell those apart: one is "ask an
 * administrator to add a provider", the other is "try again". Returning
 * `null` for a failure keeps them distinguishable.
 */
export const fetchPaymentOptions = async (
  paymentBaseUrl: string,
  config: PulseTokenConfig,
  pimId: string
): Promise<PulsePaymentOption[] | null> => {
  try {
    const token = await mintCustomerToken(config, pimId)

    const response = await fetch(`${paymentBaseUrl}/Businesses/payment-options`, {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${token}`,
        "X-API-Key": config.apiKey,
      },
    })

    if (!response.ok) {
      return null
    }

    const body: any = await response.json().catch(() => ({}))
    const options = body?.data?.options

    if (!Array.isArray(options)) {
      return null
    }

    return options.map((o: any) => ({
      provider: String(o.provider ?? ""),
      // Fall back to the key rather than dropping the option: a gateway we
      // can charge through is worth offering even if it arrives unnamed.
      displayName: String(o.displayName ?? o.provider ?? ""),
      isLive: Boolean(o.isLive),
    }))
  } catch {
    return null
  }
}
