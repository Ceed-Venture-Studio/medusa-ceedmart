import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { parseChatBody } from "../../../../lib/assistant/request"
import { assistantConfig, resolveShopper } from "../../../../lib/assistant/shopper"
import { TIMEOUT_ANSWER, translateSmartaiAnswer } from "../../../../lib/assistant/translate"

// POST /store/assistant/chat   { session_id?, message?, client_message_id? }
//
// The app's only door to SmartAI's shopping assistant (integration guide §3).
// The server decides who is chatting (signed-in customer, or a guest token
// it issued), adds SmartAI's business key, and forwards one message to
// POST /api/v3/commerce/chat. SmartAI runs the turn against Ceedmart's
// shopping MCP and answers with the reply, product cards and the cart.
//
// The key never leaves the server. SmartAI's key/billing/setup errors are
// rewritten to 503 so the app never mistakes them for its own session
// expiring (lib/assistant/translate).

const SMARTAI_TIMEOUT_MS = 45_000

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const { smartaiUrl, commerceKey } = assistantConfig()
  if (!commerceKey) {
    return res.status(503).json({
      error: { code: "assistant_unavailable", message: "The shopping assistant is not set up." },
    })
  }

  const shopper = await resolveShopper(req)
  if (!shopper) {
    // Not 401: a 401 means "your session expired" to the app.
    return res.status(403).json({
      error: {
        code: "shopper_required",
        message: "Sign in, or get a guest pass from POST /store/assistant/guest.",
      },
    })
  }

  const parsed = parseChatBody(req.body)
  if (!parsed.ok) {
    return res.status(400).json({ error: { code: "invalid_request", message: parsed.message } })
  }
  const { session_id, message, client_message_id } = parsed.value
  const requestId = client_message_id ?? randomUUID()
  const started = Date.now()

  let status: number
  let body: unknown
  let retryAfter: string | null = null
  try {
    const r = await fetch(`${smartaiUrl}/api/v3/commerce/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${commerceKey}`,
        "X-Shopper-Id": shopper.id,
        ...(shopper.firstName ? { "X-Shopper-Name": shopper.firstName } : {}),
        "Idempotency-Key": requestId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...(session_id ? { session_id } : {}), message }),
      signal: AbortSignal.timeout(SMARTAI_TIMEOUT_MS),
    })
    status = r.status
    retryAfter = r.headers.get("retry-after")
    const text = await r.text()
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError"
    logger.warn(
      `[assistant] shopper=${shopper.id} request=${requestId} ${timedOut ? "timeout" : `unreachable: ${err?.message ?? err}`} ${Date.now() - started}ms`
    )
    const answer = timedOut
      ? TIMEOUT_ANSWER
      : translateSmartaiAnswer(502, null, null)
    return res.status(answer.status).json(answer.body)
  }

  const answer = translateSmartaiAnswer(status, body, retryAfter)
  const turn = (body as any)?.turn_id
  const code = (body as any)?.error?.code
  // Ids and outcome only — never the shopper's words.
  logger.info(
    `[assistant] shopper=${shopper.id} request=${requestId} smartai=${status}${code ? `:${code}` : ""}` +
      `${turn ? ` turn=${turn}` : ""} → ${answer.status} ${Date.now() - started}ms`
  )
  if (answer.hidden) {
    logger.error(
      `[assistant] SmartAI ${answer.hidden.status} ${answer.hidden.code ?? "(no code)"} — check SMARTAI_COMMERCE_KEY, the wallet, or the MCP registration`
    )
  }
  if (answer.retryAfter) res.setHeader("Retry-After", answer.retryAfter)
  return res.status(answer.status).json(answer.body)
}
