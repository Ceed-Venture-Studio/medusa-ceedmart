// The app's chat request: { session_id?, message?, client_message_id? }.
// Checked here against SmartAI's limits so a bad call fails fast with a clear
// message instead of costing a round trip (integration guide §3).

export type ChatBody = {
  session_id: string | undefined
  /** null when the chat screen opens (SmartAI greets and recommends). */
  message: string | null
  /** The app's id for this message; becomes SmartAI's Idempotency-Key. */
  client_message_id: string | undefined
}

const SESSION = /^[A-Za-z0-9_\-.:@]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_MESSAGE = 2000

export const parseChatBody = (
  raw: unknown
): { ok: true; value: ChatBody } | { ok: false; message: string } => {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

  const message = b.message === undefined || b.message === null || b.message === "" ? null : b.message
  if (message !== null && typeof message !== "string") {
    return { ok: false, message: "message must be text" }
  }
  if (typeof message === "string" && message.length > MAX_MESSAGE) {
    return { ok: false, message: `message is limited to ${MAX_MESSAGE} characters` }
  }

  const session = b.session_id === undefined || b.session_id === null || b.session_id === "" ? undefined : b.session_id
  if (session !== undefined && (typeof session !== "string" || !SESSION.test(session))) {
    return { ok: false, message: "session_id is not valid" }
  }

  const id = b.client_message_id === undefined || b.client_message_id === null ? undefined : b.client_message_id
  if (id !== undefined && (typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, message: "client_message_id must be a UUID" }
  }

  return { ok: true, value: { session_id: session as string | undefined, message, client_message_id: id as string | undefined } }
}
