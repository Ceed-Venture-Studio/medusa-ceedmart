import { issueGuestToken, verifyGuestToken } from "./guest-token"
import { translateSmartaiAnswer } from "./translate"
import { parseChatBody } from "./request"

const SECRET = "x".repeat(40)

describe("guest tokens", () => {
  it("issues an id SmartAI accepts and verifies its own token", () => {
    const { guest_id, guest_token } = issueGuestToken(SECRET)
    expect(guest_id).toMatch(/^gst_[0-9A-Z]{26}$/)
    expect(guest_id.length).toBeLessThanOrEqual(128)
    expect(verifyGuestToken(guest_token, SECRET)).toBe(guest_id)
  })

  it("rejects forged, altered and malformed tokens", () => {
    const { guest_id, guest_token } = issueGuestToken(SECRET)
    expect(verifyGuestToken(guest_token, "y".repeat(40))).toBeNull()
    expect(verifyGuestToken(`${guest_id}.AAAA`, SECRET)).toBeNull()
    expect(verifyGuestToken(guest_token.replace("gst_", "gst_0"), SECRET)).toBeNull()
    expect(verifyGuestToken(guest_id, SECRET)).toBeNull()
    expect(verifyGuestToken("cus_123.abc", SECRET)).toBeNull()
    expect(verifyGuestToken(undefined, SECRET)).toBeNull()
    expect(verifyGuestToken("a".repeat(500), SECRET)).toBeNull()
  })
})

describe("translateSmartaiAnswer", () => {
  const err = (code: string) => ({ error: { code, message: "m" } })

  it("passes through what the app acts on", () => {
    expect(translateSmartaiAnswer(200, { reply: "hi" }, null)).toEqual({ status: 200, body: { reply: "hi" } })
    expect(translateSmartaiAnswer(404, err("session_not_found"), null).status).toBe(404)
    expect(translateSmartaiAnswer(409, err("session_busy"), null).status).toBe(409)
    expect(translateSmartaiAnswer(409, err("request_in_progress"), null).status).toBe(409)
    expect(translateSmartaiAnswer(429, err("rate_limited"), "7")).toEqual({
      status: 429,
      body: err("rate_limited"),
      retryAfter: "7",
    })
  })

  it("never lets SmartAI's key or billing errors look like the shopper's session", () => {
    for (const [status, code] of [
      [401, "invalid_api_key"],
      [402, "business_out_of_credit"],
      [402, "business_daily_cap"],
      [409, "merchant_not_verified"],
      [400, "shopper_mismatch"],
      [503, "model_not_priced"],
    ] as const) {
      const out = translateSmartaiAnswer(status, err(code), null)
      expect(out.status).toBe(503)
      expect((out.body as any).error.code).toBe("assistant_unavailable")
      expect(out.hidden).toEqual({ status, code })
    }
    expect(translateSmartaiAnswer(500, "oops", null).status).toBe(502)
  })
})

describe("parseChatBody", () => {
  it("accepts the opening call and a normal message", () => {
    expect(parseChatBody({})).toEqual({ ok: true, value: { session_id: undefined, message: null, client_message_id: undefined } })
    const id = "6f1c2a1e-1b4d-4f35-9d6a-2b8f0a7c9e10"
    expect(parseChatBody({ session_id: "sess_1", message: " rice ", client_message_id: id })).toEqual({
      ok: true,
      value: { session_id: "sess_1", message: " rice ", client_message_id: id },
    })
  })

  it("rejects what SmartAI would reject", () => {
    expect(parseChatBody({ message: "x".repeat(2001) }).ok).toBe(false)
    expect(parseChatBody({ message: 5 }).ok).toBe(false)
    expect(parseChatBody({ session_id: "a b" }).ok).toBe(false)
    expect(parseChatBody({ client_message_id: "not-a-uuid" }).ok).toBe(false)
  })
})
