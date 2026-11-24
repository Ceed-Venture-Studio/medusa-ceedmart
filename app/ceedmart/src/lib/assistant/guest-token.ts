import { createHmac, timingSafeEqual } from "node:crypto"
import { ulid } from "ulid"

// Guest identity for the shopping assistant.
//
// SmartAI keys a conversation and a chat cart on the shopper id our backend
// sends (X-Shopper-Id). For a signed-in shopper that is the Medusa customer
// id. A guest has no Medusa identity, and the id must never be a value the
// app simply asserts — anyone could then read another guest's chat — so the
// backend issues one signed token per app install:
//
//   gst_<ulid>.<base64url HMAC-SHA256(gst_<ulid>)>
//
// The app stores it and sends it back; the backend checks the signature and
// uses the part before the dot as the shopper id. `gst_` + a ULID fits
// SmartAI's shopper-id rules (letters, digits, _ - . : @, ≤ 128).

const PREFIX = "gst_"
const ID = /^gst_[0-9A-HJKMNP-TV-Z]{26}$/

const sign = (id: string, secret: string) =>
  createHmac("sha256", secret).update(id).digest("base64url")

/** A new guest id and the token that proves it. */
export const issueGuestToken = (secret: string): { guest_id: string; guest_token: string } => {
  const guest_id = `${PREFIX}${ulid()}`
  return { guest_id, guest_token: `${guest_id}.${sign(guest_id, secret)}` }
}

/** The guest id a token proves, or null for anything forged or malformed. */
export const verifyGuestToken = (token: unknown, secret: string): string | null => {
  if (typeof token !== "string" || token.length > 200) return null
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const id = token.slice(0, dot)
  if (!ID.test(id)) return null
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(id, secret))
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null
}
