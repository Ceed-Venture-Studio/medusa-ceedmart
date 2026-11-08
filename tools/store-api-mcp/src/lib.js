// Pure helpers for server.js, kept apart so they can be tested without
// starting the server.

const ALLOWED_PATH = /^\/(store|auth\/customer)(\/|$)/
const ALSO_ALLOWED = new Set(["/auth/token/refresh"])

/**
 * Why a call_store_api request must not be sent, or null when it may be.
 * Only shopper-facing paths, no traversal, and outside staging GET only —
 * and only when production access was switched on.
 */
export const checkRequest = ({ method, path, config }) => {
  if (!path.startsWith("/")) return "Path must start with /, e.g. /store/products."
  if (/\.\.|\/\/|[?#]/.test(path)) {
    return "Path must be a plain path: no '..', '//', or query string (use the query argument)."
  }
  if (!ALLOWED_PATH.test(path) && !ALSO_ALLOWED.has(path)) {
    return "Only shopper-facing paths are allowed: /store/*, /auth/customer/*, /auth/token/refresh."
  }
  if (!config.isStaging) {
    if (!config.allowProduction) {
      return `Live calls are only enabled against staging. This server points at ${config.apiUrl}.`
    }
    if (method !== "GET") {
      return "Outside staging only GET requests are allowed (CEEDMART_ALLOW_PRODUCTION=read-only)."
    }
  }
  return null
}

export const summarizeEndpoint = (e) => ({
  id: e.id,
  method: e.method,
  path: e.path,
  group: e.group,
  auth: e.auth,
  summary: e.summary,
})

export const truncate = (s, max) =>
  s.length <= max
    ? s
    : `${s.slice(0, max)}\n\n… truncated ${s.length - max} more characters. Narrow the request with fields= or limit=, or raise max_chars.`
