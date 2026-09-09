import PulsePayService from "../pulse-pay"

// A rejected token must cost one retry, not a lost payment.
//
// Customer tokens are cached until just before their `exp`, which handles
// ordinary expiry. It does not handle a token invalidated EARLY — Identity
// restarting with new signing keys, a revoked session, clock skew. Pulse
// answers 401 INVALID_TOKEN for those (verified against a live instance),
// and the cached copy still looks valid, so without eviction every caller
// inside the cache window fails the same way. The webhook's three retries
// run within seconds, so all three would reuse the dead token and the
// payment would be lost to a key change that lasted a moment.

const TOKEN_URL = /\/customers\/.*\/token$/

const makeService = () =>
  new (PulsePayService as any)(
    {},
    {
      apiKey: "test-key",
      tenantId: "tenant",
      applicationId: "app",
      baseUrl: "https://payments.test/api/v1",
      identityBaseUrl: "https://identity.test/api/v1",
    }
  )

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }) as any

describe("a 401 from Pulse", () => {
  let minted: number

  const mockFetch = (paymentResponses: any[]) => {
    minted = 0
    const queue = [...paymentResponses]
    global.fetch = jest.fn(async (url: any) => {
      if (TOKEN_URL.test(String(url))) {
        minted++
        return jsonResponse(200, {
          payload: { value: { token: `minted-${minted}` } },
        })
      }
      return queue.shift()
    }) as any
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("mints a fresh token and retries once", async () => {
    mockFetch([
      jsonResponse(401, { error: { code: "INVALID_TOKEN" } }),
      jsonResponse(200, { data: { value: { status: 3 } } }),
    ])

    const svc = makeService()
    const result = await (svc as any).pulseRequest(
      "GET",
      "/Payments/abc",
      undefined,
      "pim_1"
    )

    expect(result?.data?.value?.status).toBe(3)
    // Two mints: the first call, then again after the cache was dropped.
    expect(minted).toBe(2)
  })

  it("does not retry forever when the fresh token is also refused", async () => {
    mockFetch([
      jsonResponse(401, { error: { code: "INVALID_TOKEN" } }),
      jsonResponse(401, { error: { code: "INVALID_TOKEN" } }),
    ])

    const svc = makeService()
    await expect(
      (svc as any).pulseRequest("GET", "/Payments/abc", undefined, "pim_1")
    ).rejects.toThrow(/Pulse Payment API error/)

    expect(minted).toBe(2)
  })

  it("leaves the static bearer alone — there is nothing to re-mint", async () => {
    mockFetch([jsonResponse(401, { error: { code: "INVALID_TOKEN" } })])

    const svc = makeService()
    await expect(
      (svc as any).pulseRequest("GET", "/Payments/abc")
    ).rejects.toThrow(/Pulse Payment API error/)

    expect(minted).toBe(0)
  })

  it("reuses the cached token when nothing rejects it", async () => {
    mockFetch([
      jsonResponse(200, { data: {} }),
      jsonResponse(200, { data: {} }),
    ])

    const svc = makeService()
    await (svc as any).pulseRequest("GET", "/Payments/a", undefined, "pim_1")
    await (svc as any).pulseRequest("GET", "/Payments/b", undefined, "pim_1")

    expect(minted).toBe(1)
  })
})
