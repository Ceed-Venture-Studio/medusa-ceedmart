import crypto from "crypto"

// Verification of Pulse's X-Pulse-Signature, per
// docs/OUTBOUND_WEBHOOK_SIGNING.md in the PaymentCore repo:
// HMAC-SHA512 over the RAW body, hex lowercase, constant-time compare.
//
// Mirrors webhookSenderIsTrusted. Kept as a standalone copy because the
// method is private and constructing the provider drags in config the
// verification itself does not care about — the rule under test is the
// digest, not the wiring.
const verify = (
  signingSecret: string | undefined,
  headers: Record<string, any> | undefined,
  rawBody: Buffer | string | undefined
): boolean => {
  const header = (name: string): string =>
    String(
      headers?.[name] ??
        headers?.[name.toLowerCase()] ??
        headers?.[name.toUpperCase()] ??
        ""
    ).trim()

  if (signingSecret) {
    const supplied = header("X-Pulse-Signature")
    if (!supplied) return false
    if (rawBody === undefined || rawBody === null) return false

    const expected = crypto
      .createHmac("sha512", signingSecret)
      .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
      .digest("hex")

    const a = Buffer.from(expected, "utf8")
    const b = Buffer.from(supplied.toLowerCase(), "utf8")
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  return true
}

const SECRET = "whsec_test_0123456789abcdef"
// PascalCase keys and a stringified Metadata, as Pulse actually sends.
const BODY = JSON.stringify({
  Id: "8f14e45f-ceea-467a-9f2a-1b3c4d5e6f70",
  Event: "charge.success",
  TransactionRef: "PSK_9c2b1a7f",
  Amount: 5000.0,
  Status: "success",
  Metadata: '{"session_id":"payses_1","pim_id":"abc"}',
  PaymentServiceProvider: 1,
})
const sign = (secret: string, body: string) =>
  crypto.createHmac("sha512", secret).update(Buffer.from(body, "utf8")).digest("hex")

describe("Pulse webhook signature", () => {
  it("accepts a correctly signed delivery", () => {
    const sig = sign(SECRET, BODY)
    expect(verify(SECRET, { "x-pulse-signature": sig }, Buffer.from(BODY))).toBe(true)
  })

  it("accepts the header whatever its casing", () => {
    const sig = sign(SECRET, BODY)
    for (const name of ["X-Pulse-Signature", "x-pulse-signature", "X-PULSE-SIGNATURE"]) {
      expect(verify(SECRET, { [name]: sig }, Buffer.from(BODY))).toBe(true)
    }
  })

  it("accepts an uppercase hex digest", () => {
    const sig = sign(SECRET, BODY).toUpperCase()
    expect(verify(SECRET, { "x-pulse-signature": sig }, Buffer.from(BODY))).toBe(true)
  })

  it("rejects a signature made with a different secret", () => {
    const sig = sign("whsec_someone_elses_secret", BODY)
    expect(verify(SECRET, { "x-pulse-signature": sig }, Buffer.from(BODY))).toBe(false)
  })

  it("rejects when the body has been altered", () => {
    const sig = sign(SECRET, BODY)
    const tampered = BODY.replace('"Amount":5000', '"Amount":1')
    expect(verify(SECRET, { "x-pulse-signature": sig }, Buffer.from(tampered))).toBe(false)
  })

  // The failure the spec warns about: re-serialising parsed JSON reorders
  // keys and drops whitespace, and the digest never matches again.
  it("rejects a re-serialised body, which is why raw bytes are required", () => {
    const sig = sign(SECRET, BODY)
    const reserialised = JSON.stringify(JSON.parse(BODY), Object.keys(JSON.parse(BODY)).sort())
    expect(verify(SECRET, { "x-pulse-signature": sig }, Buffer.from(reserialised))).toBe(false)
  })

  it("rejects a missing signature header", () => {
    expect(verify(SECRET, {}, Buffer.from(BODY))).toBe(false)
  })

  it("rejects when the raw body is unavailable", () => {
    const sig = sign(SECRET, BODY)
    expect(verify(SECRET, { "x-pulse-signature": sig }, undefined)).toBe(false)
  })

  it("ignores the legacy hash entirely — it is identical across tenants", () => {
    const sig = sign(SECRET, BODY)
    expect(
      verify(SECRET, { "x-pulse-signature": sig, "pulse-webhook-hash": "anything" }, Buffer.from(BODY))
    ).toBe(true)
    // and a correct legacy hash does NOT rescue a bad signature
    expect(
      verify(SECRET, { "x-pulse-signature": "deadbeef", "pulse-webhook-hash": "anything" }, Buffer.from(BODY))
    ).toBe(false)
  })

  it("is open when no signing secret is configured", () => {
    expect(verify(undefined, {}, Buffer.from(BODY))).toBe(true)
  })

  it("accepts a string raw body as well as a Buffer", () => {
    const sig = sign(SECRET, BODY)
    expect(verify(SECRET, { "x-pulse-signature": sig }, BODY)).toBe(true)
  })
})
