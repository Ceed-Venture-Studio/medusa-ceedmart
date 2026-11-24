// What the app sees for each SmartAI answer (SmartAI integration guide §8).
//
// SmartAI's own key, billing and setup problems must not reach the app as
// 401/402: the app reads a 401 as "your session expired" and would sign the
// shopper out. They become one 503 `assistant_unavailable`, and the real
// cause is logged here for on-call. Statuses the app acts on pass through.

export type AppAnswer = {
  status: number
  body: unknown
  retryAfter?: string
  /** For our logs: SmartAI's status and code when we rewrote them. */
  hidden?: { status: number; code: string | null }
}

const UNAVAILABLE = {
  error: {
    code: "assistant_unavailable",
    message: "The shopping assistant is unavailable right now. Please try again later.",
  },
}

const codeOf = (body: any): string | null =>
  typeof body?.error?.code === "string" ? body.error.code : null

export const translateSmartaiAnswer = (
  status: number,
  body: unknown,
  retryAfter: string | null
): AppAnswer => {
  const code = codeOf(body)

  // A normal turn — including 200s that carry `error` beside a reply.
  if (status === 200) return { status, body }

  // The app handles these itself.
  if (status === 404 && code === "session_not_found") return { status, body }
  if (status === 409 && (code === "request_in_progress" || code === "session_busy")) {
    return { status, body }
  }
  if (status === 429) {
    return { status, body, ...(retryAfter ? { retryAfter } : {}) }
  }
  // Over-long message: the app caps input at 2,000, but say so if it slips.
  if (status === 400 && code === "invalid_request") return { status, body }

  // Everything else is ours or SmartAI's to fix, not the shopper's:
  // 401 invalid_api_key, 402 out of credit / daily cap, 409 merchant not
  // configured or verified, 400 shopper_mismatch, 503 model_not_priced, 5xx.
  return {
    status: status >= 500 && !code ? 502 : 503,
    body: UNAVAILABLE,
    hidden: { status, code },
  }
}

export const TIMEOUT_ANSWER: AppAnswer = {
  status: 504,
  body: {
    error: {
      code: "assistant_timeout",
      message: "The assistant took too long to answer. Send the message again.",
    },
  },
}
