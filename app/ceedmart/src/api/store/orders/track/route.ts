import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

// Public order tracking endpoint. Customer enters their order display_id
// (short number shown on receipts) plus a contact (phone or email) they
// used at checkout. Match order:
//   - order.email exact case-insensitive
//   - order.shipping_address.phone exact
// Both are required to prevent order-number enumeration.
//
// Response is a safe subset: no line item details, no addresses, no
// customer PII beyond what the caller already knows. Just enough to
// answer "where is my order?".
//
// Rate limited via Redis (per IP + per contact) to slow enumeration
// attempts. Fails open when Redis is unavailable (dev without redis).

type TrackContext = {
  attempts: number
  limit: number
}

const RATE_LIMIT_PER_MIN = 20
const RATE_LIMIT_WINDOW_S = 60

const normEmail = (v: string) => v.trim().toLowerCase()
const normPhone = (v: string) => v.replace(/\s+/g, "").trim()
const looksLikeEmail = (v: string) => v.includes("@")

const getClientIp = (req: MedusaRequest): string => {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined) ?? ""
  return fwd.split(",")[0]?.trim() || req.ip || "unknown"
}

const enforceRateLimit = async (
  req: MedusaRequest,
  contact: string
): Promise<TrackContext> => {
  const ip = getClientIp(req)
  const key = `track:${ip}:${contact}`
  try {
    const cache: any = req.scope.resolve(Modules.CACHE)
    const raw = await cache.get(key)
    const current = raw ? Number(raw) : 0
    if (current >= RATE_LIMIT_PER_MIN) {
      return { attempts: current, limit: RATE_LIMIT_PER_MIN }
    }
    await cache.set(key, String(current + 1), RATE_LIMIT_WINDOW_S)
    return { attempts: current + 1, limit: RATE_LIMIT_PER_MIN }
  } catch {
    // Fail-open on cache failure so tracking still works.
    return { attempts: 0, limit: RATE_LIMIT_PER_MIN }
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const refRaw = req.query.ref as string | undefined
  const contactRaw = req.query.contact as string | undefined

  if (!refRaw?.trim() || !contactRaw?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "ref and contact query parameters are required"
    )
  }

  const contact = contactRaw.trim()
  const rate = await enforceRateLimit(req, contact.toLowerCase())
  if (rate.attempts > rate.limit) {
    res.status(429).json({
      message: "Too many tracking requests. Try again in a minute.",
    })
    return
  }

  const displayId = Number(String(refRaw).replace(/^#/, "").trim())
  if (!Number.isFinite(displayId) || displayId <= 0) {
    // Present a 404 rather than a distinguishing error — never hint at
    // which of ref / contact was wrong.
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No matching order"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "status",
      "payment_status",
      "fulfillment_status",
      "currency_code",
      "summary.*",
      "shipping_address.phone",
      "items.id",
      "fulfillments.id",
      "fulfillments.tracking_numbers",
      "fulfillments.shipped_at",
      "fulfillments.delivered_at",
    ],
    filters: { display_id: displayId },
    pagination: { skip: 0, take: 1 },
  })
  const order = (orders as any[])[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No matching order")
  }

  const orderEmail = (order.email ?? "").toLowerCase()
  const orderPhone = normPhone(order.shipping_address?.phone ?? "")
  const matches = looksLikeEmail(contact)
    ? normEmail(contact) === orderEmail
    : normPhone(contact) === orderPhone

  if (!matches) {
    // 404 not 401/403 — again, no distinguishing feedback.
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No matching order")
  }

  // First tracking number across all fulfillments, if any.
  const trackingNumber = (order.fulfillments ?? [])
    .flatMap((f: any) => f?.tracking_numbers ?? [])
    .find((n: any) => typeof n === "string" && n.length > 0)

  res.json({
    order: {
      id: order.id,
      display_id: order.display_id,
      status: order.status ?? "pending",
      payment_status: order.payment_status ?? "not_paid",
      fulfillment_status: order.fulfillment_status ?? "not_fulfilled",
      currency_code: order.currency_code,
      total: Number(order.summary?.current_order_total ?? 0),
      item_count: (order.items ?? []).length,
      tracking_number: trackingNumber ?? null,
      shipped_at:
        (order.fulfillments ?? [])
          .map((f: any) => f?.shipped_at)
          .find((v: any) => v != null) ?? null,
      delivered_at:
        (order.fulfillments ?? [])
          .map((f: any) => f?.delivered_at)
          .find((v: any) => v != null) ?? null,
    },
  })
}
