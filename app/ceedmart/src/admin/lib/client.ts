// Custom admin extensions can't use relative URLs for backend calls — in
// production the admin is served from its own Cloud Run service while the
// API lives on a separate origin. The admin bundler injects the API URL as
// `__BACKEND_URL__` (see Dockerfile.admin → MEDUSA_BACKEND_URL → admin-bundler
// vite define), so we read it here and prefix every request.
//
// Dev (`medusa develop`): __BACKEND_URL__ is empty/"/", same-origin works.
// Prod: __BACKEND_URL__ is the API origin, e.g. https://ceedmart-api-….run.app.

declare const __BACKEND_URL__: string | undefined

export const BACKEND_URL: string =
  typeof __BACKEND_URL__ === "string" && __BACKEND_URL__.length > 0
    ? __BACKEND_URL__.replace(/\/$/, "")
    : ""

/** Builds an absolute URL when the backend lives on a different origin. */
export function backendUrl(path: string): string {
  if (!BACKEND_URL) return path
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  return `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * Thin fetch helper for admin extensions. Adds `credentials: "include"` so
 * the admin's auth cookie is sent cross-origin in prod, and routes through
 * the baked-in backend URL.
 */
export async function fetchAdmin<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(backendUrl(path), {
    credentials: "include",
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.message) message = String(body.message)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }
  // Caller may expect void — JSON parse will fail on empty 204 responses.
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
