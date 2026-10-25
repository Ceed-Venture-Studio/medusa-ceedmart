import {
  INotificationModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  promiseAll,
} from "@medusajs/framework/utils"
import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

type NotificationHandler = {
  event: string
  channel: "email" | "sms"
  subject?: string
  /** Overrides `subject` when the line depends on the entity. */
  getSubject?: (data: any) => string
  template: string
  // Entity type and fields to fetch when event payload only contains IDs
  entity?: string
  fields?: string[]
  /** One address, or several — each gets its own notification. */
  getTo: (data: any) => string | string[] | undefined
  getBody: (data: any) => string
  getSmsBody?: (data: any) => string
  /** Return true to say nothing for this particular entity. Distinct from
   *  getTo returning undefined, which means "no address"; this means "there
   *  is an address and we deliberately are not writing to it". */
  skipWhen?: (data: any) => boolean
  /** Logged when skipWhen holds. */
  skipReason?: string
}

// The Pulse Pay notification provider renders the body as plain text inside
// its own "Dear User / Best Regards, Pulse Pay" template — any HTML we send
// gets escaped and shown literally to the customer. Keep these bodies as
// plain text with \n line breaks.

const STOREFRONT_URL =
  (process.env.STORE_CORS || "https://ceedmart.com").split(",")[0].replace(/\/$/, "")
// Country code used in storefront URLs (e.g. /ng/order/...). Ceedmart only
// ships in Nigeria today; if we add markets later this needs to be derived
// from the order's region.
const STOREFRONT_COUNTRY = "ng"

// Medusa wraps numbers in { value, precision } when the column is BigNumber.
// Normalise to a plain JS number for arithmetic + formatting.
const toNumber = (v: unknown): number => {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (v && typeof v === "object" && "value" in (v as any)) {
    const inner = (v as any).value
    const n = typeof inner === "number" ? inner : Number(inner)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

const NGN_CURRENCIES = new Set(["ngn", "NGN"])
const formatMoney = (amount: unknown, currency?: string | null): string => {
  const n = toNumber(amount)
  if (!Number.isFinite(n)) return "—"
  const cc = (currency || "").toLowerCase()
  if (NGN_CURRENCIES.has(cc)) {
    return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
  }
  if (!cc) return n.toLocaleString()
  return `${n.toLocaleString()} ${cc.toUpperCase()}`
}

// The reset link. The token IS the credential, so this URL must only ever
// go to the address that asked for it — which is why the email is sent to
// data.entity_id and nowhere else, and why nothing logs it.
const resetPasswordUrl = (token: string): string =>
  `${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/account/reset-password?token=${encodeURIComponent(
    token
  )}`

// Where an operator goes to act on the order. ADMIN_CORS is a list of
// allowed origins; the first is the admin we actually run. Unset falls back
// to the hosted admin rather than producing a link to nowhere.
const ADMIN_URL = (
  process.env.ADMIN_CORS || "https://admin-core.ceedmart.com"
)
  .split(",")[0]
  .trim()
  .replace(/\/$/, "")

const adminOrderUrl = (orderId: string): string =>
  `${ADMIN_URL}/app/orders/${orderId}`

const orderViewUrl = (orderId: string): string =>
  `${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/order/${orderId}/confirmed`

// Persistent bookmark-friendly URL — customer types display_id + contact
// on the tracking page. Unlike orderViewUrl this can be shared / revisited
// without needing the exact order UUID, and it survives session state loss.
const trackUrl = (displayId: number | string | undefined | null): string => {
  const ref = displayId != null ? String(displayId) : ""
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ""
  return `${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/track${q}`
}

const renderItemsList = (items: any[] = [], currency?: string): string => {
  if (!items.length) return ""
  return items
    .map((it: any) => {
      // OrderItem (the junction with quantity) lives at items[].detail.
      // items[] itself surfaces OrderLineItem fields (title, unit_price).
      const qty = toNumber(it.detail?.quantity ?? it.quantity ?? 1) || 1
      const unitPrice = toNumber(it.unit_price)
      const title = it.product_title || it.title || "Item"
      const variantBit =
        it.variant_title && it.variant_title !== it.product_title
          ? ` (${it.variant_title})`
          : ""
      // items[].total returns 0 in subscriber context (computed only in
      // the admin REST query layer), so we calculate from raw unit_price.
      const lineTotal = qty * unitPrice
      return `  • ${qty} × ${title}${variantBit} — ${formatMoney(lineTotal, currency)}`
    })
    .join("\n")
}

// ── Who to reach, and where that actually lives ─────────────────────────
//
// Checkout requires an email and a phone from every customer, so an order
// always carries both — but not where you would guess. `email` is on the
// order; `phone` is NOT. It exists only inside the addresses, and the old
// SMS fallback read `data.phone`, a field the order does not have, so a
// missing shipping phone meant no text rather than the billing one.
//
// Billing is a real fallback rather than a theoretical one: a pickup order
// collects contact details only and submits them as both addresses, and a
// customer using a saved address may have the number on just one of them.
// ── Was this rung up at a till? ─────────────────────────────────────────
//
// A POS sale emits order.placed exactly like a web order, so the customer
// standing at the counter was getting an email and an SMS about the thing
// they had just been handed, and the shop was texting itself about a sale
// its own cashier had made.
//
// Keyed on channel === "in-store" and nothing else. The POS has one
// order-creation path and stamps that value on the draft immediately before
// converting it, so a till sale is always marked.
//
// Deliberately NOT the inverse test. The storefront only writes
// channel: "online" when the customer touches the delivery/pickup selector,
// so a web order can carry no channel at all — and "notify only when
// explicitly online" would silently drop those confirmations. Absent means
// notify; only an explicit in-store marker silences us.
//
// store_id is not usable here either: an online PICKUP order carries the
// shop's id too, and suppressing on it would mute genuine web orders.
// ── The shop's order alert ──────────────────────────────────────────────
//
// Recipients are comma-separated lists in the environment, e.g.
//   ORDER_ALERT_EMAIL=ops@example.com,owner@example.com
//   ORDER_ALERT_PHONE=+2349030000000,+2347080000000
const envList = (name: string): string[] =>
  (process.env[name] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)

// Only paid orders are fulfilled, so only paid orders alert the shop. Paid
// means a real gateway has authorized or captured it: a Pulse session only
// turns authorized once Pulse confirms the money, while Medusa's manual
// provider (pp_system_default) authorizes with no money at all.
const PAID_COLLECTION_STATUSES = new Set([
  "authorized",
  "partially_captured",
  "completed",
])
const isPaidOnline = (data: any): boolean =>
  (data?.payment_collections ?? []).some(
    (pc: any) =>
      PAID_COLLECTION_STATUSES.has(pc?.status) &&
      (pc?.payments ?? []).some(
        (p: any) =>
          p?.provider_id && !String(p.provider_id).startsWith("pp_system_default")
      )
  )

// "NGN 45,500" rather than "₦45,500": ₦ (and — and •) are outside the GSM
// 7-bit alphabet, and one such character switches the whole SMS to UCS-2 —
// 70 characters a part instead of 160, so a one-line alert bills as two or
// three messages per recipient. The email uses the same form to match.
const formatNgnPlain = (amount: unknown): string =>
  `NGN ${Math.round(toNumber(amount)).toLocaleString("en-NG")}`

const isPickupOrder = (data: any): boolean => {
  const mode = data?.metadata?.ceedmart?.fulfillment
  if (mode) return mode === "pickup"
  const method = (data?.shipping_methods ?? [])[0]?.name ?? ""
  return /pickup/i.test(method)
}

// wa.me wants the international number with no "+" or leading zero.
const whatsAppUrl = (phone?: string): string | undefined => {
  if (!phone) return undefined
  let digits = phone.replace(/\D/g, "")
  if (digits.startsWith("0")) digits = "234" + digits.slice(1)
  return digits.length >= 10 ? `https://wa.me/${digits}` : undefined
}

const placedAtLagos = (createdAt?: string | Date): string | undefined => {
  if (!createdAt) return undefined
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

const itemCount = (items: any[] = []): number =>
  items.reduce(
    (n: number, it: any) => n + (toNumber(it.detail?.quantity ?? 1) || 1),
    0
  )

const isTillSale = (data: any): boolean =>
  (data?.metadata?.ceedmart?.channel ?? null) === "in-store"

const customerEmail = (data: any): string | undefined =>
  data?.email || data?.customer?.email || undefined

const customerPhone = (data: any): string | undefined =>
  data?.shipping_address?.phone ||
  data?.billing_address?.phone ||
  data?.customer?.phone ||
  undefined

const orderTotal = (data: any): number => {
  // summary.current_order_total holds the canonical post-edit total once
  // Medusa's order summary has been populated; in admin REST contexts the
  // top-level order.total is the same value, but in subscriber context that
  // top-level field can be stale/zero so we read from summary instead.
  const fromSummary = toNumber(data.summary?.current_order_total)
  if (fromSummary > 0) return fromSummary
  return toNumber(data.total)
}

const itemsSubtotal = (items: any[] = []): number =>
  items.reduce((sum, it) => {
    const qty = toNumber(it.detail?.quantity ?? it.quantity ?? 1) || 1
    return sum + qty * toNumber(it.unit_price)
  }, 0)

/**
 * Resolves full entity data from an event payload.
 * Events emit either full objects or arrays of { id } references.
 */
async function resolveEntityData(
  payload: any,
  handler: NotificationHandler,
  container: MedusaContainer
): Promise<any[]> {
  // auth.password_reset and invite events emit full data directly
  if (!handler.entity) {
    const items = Array.isArray(payload) ? payload : [payload]
    return items
  }

  // Other events emit [{ id }] — we need to query for full data
  const items = Array.isArray(payload) ? payload : [payload]
  const ids = items.map((i: any) => i.id).filter(Boolean)
  if (!ids.length) return []

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: handler.entity,
    filters: { id: ids },
    fields: handler.fields || ["*"],
  })

  return data || []
}

const handlers: NotificationHandler[] = [
  // ── Order Placed ──
  {
    event: "order.placed",
    channel: "email",
    subject: "Your Ceedmart order has been placed!",
    template: "order-placed",
    entity: "order",
    fields: [
      "id",
      "email",
      "display_id",
      "currency_code",
      "summary.*",
      "shipping_address.first_name",
      "*items",
      "items.title",
      "items.product_title",
      "items.variant_title",
      "items.unit_price",
      // items[].detail is the OrderItem junction that carries quantity.
      "items.detail.quantity",
      "customer.email",
      "metadata",
    ],
    getTo: (data) => customerEmail(data),
    skipWhen: isTillSale,
    getBody: (data) => {
      const orderRef = data.display_id ? `#${data.display_id}` : data.id
      const greeting = data.shipping_address?.first_name || "there"
      const items = data.items ?? []
      const itemsBlock = renderItemsList(items, data.currency_code)
      const subtotal = itemsSubtotal(items)
      const total = orderTotal(data)
      const lines: string[] = [
        `Hi ${greeting},`,
        ``,
        `Thank you for your order! Your order ${orderRef} has been placed successfully.`,
      ]

      if (itemsBlock) {
        lines.push(``, `Items:`, itemsBlock)
      }

      lines.push(``, `Summary:`)
      if (subtotal > 0) {
        lines.push(`  Subtotal: ${formatMoney(subtotal, data.currency_code)}`)
      }
      // Surface the spread between item subtotal and order total as a
      // single "Adjustments" line (covers tax, shipping, discount, and any
      // promotions in one bucket — keeps the email short and avoids the
      // per-field zero-fallback that a non-populated tax_total exposes).
      const adjustments = total - subtotal
      if (Math.abs(adjustments) > 0.01) {
        const label = adjustments > 0 ? "Tax & shipping" : "Discount"
        const display = formatMoney(Math.abs(adjustments), data.currency_code)
        lines.push(
          `  ${label}: ${adjustments < 0 ? "-" : ""}${display}`
        )
      }
      lines.push(`  Total: ${formatMoney(total, data.currency_code)}`)

      lines.push(
        ``,
        `View your order: ${orderViewUrl(data.id)}`,
        `Track anytime: ${trackUrl(data.display_id)}`,
        ``,
        `We'll notify you when it ships.`,
        ``,
        `— Ceedmart`
      )
      return lines.join("\n")
    },
  },
  {
    event: "order.placed",
    channel: "sms",
    template: "order-placed-sms",
    entity: "order",
    fields: [
      "id",
      "display_id",
      "shipping_address.*",
      "billing_address.phone",
      "customer.phone",
      "metadata",
    ],
    getTo: (data) => customerPhone(data),
    skipWhen: isTillSale,
    getBody: () => "",
    getSmsBody: (data) =>
      `Ceedmart: Your order ${data.display_id ? "#" + data.display_id : ""} has been placed! We'll notify you when it ships.`,
  },

  // ── Order Placed: the shop's own copy ──
  //
  // Placing an order is the one event someone has to ACT on. Only paid
  // online orders alert the shop: till sales are rung up in front of a
  // cashier, and unpaid orders are not fulfilled.
  //
  // Recipients come from the environment (comma-separated), and an unset
  // value means silent rather than broken — the same contract
  // LOW_STOCK_ALERT_EMAIL and STOCK_TRANSFER_ALERT_EMAIL already use.
  {
    event: "order.placed",
    channel: "email",
    template: "order-placed-admin",
    entity: "order",
    fields: [
      "id",
      "email",
      "display_id",
      "created_at",
      "currency_code",
      "summary.*",
      "shipping_address.*",
      "*items",
      "items.title",
      "items.product_title",
      "items.variant_title",
      "items.unit_price",
      "items.detail.quantity",
      "*shipping_methods",
      "billing_address.phone",
      "customer.email",
      "customer.phone",
      "payment_collections.status",
      "payment_collections.payments.provider_id",
      "metadata",
    ],
    getTo: () => envList("ORDER_ALERT_EMAIL"),
    skipWhen: (data) => isTillSale(data) || !isPaidOnline(data),
    skipReason: "till sale or not paid",
    getSubject: (data) => {
      const ref = data.display_id ? `#${data.display_id}` : data.id
      const addr = data.shipping_address ?? {}
      const how = isPickupOrder(data)
        ? "Pickup"
        : `Delivery${addr.city ? `, ${addr.city}` : ""}`
      return `New order ${ref} · ${formatNgnPlain(orderTotal(data))} · ${how}`
    },
    getBody: (data) => {
      const ref = data.display_id ? `#${data.display_id}` : data.id
      const addr = data.shipping_address ?? {}
      const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ")
      const phone = customerPhone(data)
      const items = data.items ?? []
      const placed = placedAtLagos(data.created_at)

      // Everything needed to start picking, in the body. An operator
      // reading this on a phone should not have to open the admin to know
      // what was bought and where it is going.
      const lines: string[] = [`NEW ONLINE ORDER ${ref}`]
      if (placed) lines.push(`Placed ${placed}`)

      lines.push(
        ``,
        `CUSTOMER`,
        `  ${name || "(no name)"}`,
        `  Phone: ${phone || "(none)"}`,
        `  Email: ${customerEmail(data) || "(none)"}`,
        ``,
        `FULFILMENT`
      )
      if (isPickupOrder(data)) {
        const method = (data.shipping_methods ?? [])[0]?.name
        lines.push(`  Pickup${method ? `: ${method}` : ""}`)
      } else {
        const where = [addr.address_1, addr.address_2, addr.city, addr.province]
          .filter(Boolean)
          .join(", ")
        lines.push(
          `  Deliver to: ${where || "(no address)"}`,
          // Checkout never charges delivery — the fee is agreed afterwards.
          `  Delivery fee: to be agreed with the customer`
        )
      }

      lines.push(``, `PAYMENT`, `  PAID online`, ``, `ITEMS`)
      for (const it of items) {
        const qty = toNumber(it.detail?.quantity ?? it.quantity ?? 1) || 1
        const unit = toNumber(it.unit_price)
        const title = it.product_title || it.title || "Item"
        const variant =
          it.variant_title && it.variant_title !== it.product_title
            ? ` (${it.variant_title})`
            : ""
        lines.push(
          `  ${qty} x ${title}${variant}: ${formatNgnPlain(unit)} each = ${formatNgnPlain(qty * unit)}`
        )
      }

      const subtotal = itemsSubtotal(items)
      const total = orderTotal(data)
      lines.push(``, `  Subtotal: ${formatNgnPlain(subtotal)}`)
      if (subtotal > total) {
        lines.push(`  Discount: -${formatNgnPlain(subtotal - total)}`)
      }
      lines.push(`  TOTAL: ${formatNgnPlain(total)}`, ``, `NEXT STEPS`)
      lines.push(`  Open in admin: ${adminOrderUrl(data.id)}`)
      const wa = whatsAppUrl(phone)
      if (wa) lines.push(`  WhatsApp the customer: ${wa}`)
      lines.push(``, `Ceedmart order alerts`)
      return lines.join("\n")
    },
  },
  {
    event: "order.placed",
    channel: "sms",
    template: "order-placed-admin-sms",
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "summary.*",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.city",
      "*shipping_methods",
      "*items",
      "items.detail.quantity",
      "payment_collections.status",
      "payment_collections.payments.provider_id",
      "metadata",
    ],
    getTo: () => envList("ORDER_ALERT_PHONE"),
    skipWhen: (data) => isTillSale(data) || !isPaidOnline(data),
    skipReason: "till sale or not paid",
    getBody: () => "",
    // One GSM-7 message: a nudge to go and look — the email carries the
    // detail. No customer phone number: it would sit on staff phones.
    getSmsBody: (data) => {
      const ref = data.display_id ? `#${data.display_id}` : ""
      const n = itemCount(data.items ?? [])
      const addr = data.shipping_address ?? {}
      const who = [addr.first_name, addr.last_name].filter(Boolean).join(" ")
      const how = isPickupOrder(data)
        ? "Pickup"
        : `Delivery${addr.city ? ` to ${addr.city}` : ""}`
      return (
        `Ceedmart NEW ORDER ${ref}: ${n} item${n === 1 ? "" : "s"}, ` +
        `${formatNgnPlain(orderTotal(data))}, PAID. ${how}.` +
        `${who ? ` ${who}.` : ""} Full details sent to email.`
      )
    },
  },

  // ── Order Canceled ──
  {
    event: "order.canceled",
    channel: "email",
    subject: "Your Ceedmart order has been canceled",
    template: "order-canceled",
    entity: "order",
    fields: ["id", "email", "display_id", "shipping_address.first_name"],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.display_id ? `#${data.display_id}` : data.id
      const greeting = data.shipping_address?.first_name || "there"
      return [
        `Hi ${greeting},`,
        ``,
        `Your order ${orderRef} has been canceled.`,
        ``,
        `If you have questions, please contact our support team.`,
        ``,
        `— Ceedmart`,
      ].join("\n")
    },
  },

  // ── Fulfillment Created (order shipped) ──
  {
    event: "order.fulfillment_created",
    channel: "email",
    subject: "Your Ceedmart order is on its way!",
    template: "order-shipped",
    entity: "order",
    fields: ["id", "email", "display_id", "shipping_address.first_name"],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.display_id ? `#${data.display_id}` : data.id
      const greeting = data.shipping_address?.first_name || "there"
      return [
        `Hi ${greeting},`,
        ``,
        `Good news — your order ${orderRef} has shipped.`,
        ``,
        `Track and view: ${orderViewUrl(data.id)}`,
        ``,
        `— Ceedmart`,
      ].join("\n")
    },
  },
  {
    event: "order.fulfillment_created",
    channel: "sms",
    template: "order-shipped-sms",
    entity: "order",
    fields: [
      "id",
      "display_id",
      "shipping_address.*",
      "billing_address.phone",
      "customer.phone",
    ],
    getTo: (data) => customerPhone(data),
    getBody: () => "",
    getSmsBody: (data) =>
      `Ceedmart: Your order ${data.display_id ? "#" + data.display_id : ""} has been shipped!`,
  },

  // ── Return Requested ──
  {
    event: "order.return_requested",
    channel: "email",
    subject: "Your return request has been received",
    template: "return-requested",
    entity: "order",
    fields: ["id", "email", "display_id"],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.order?.display_id ? `#${data.order.display_id}` : ""
      return [
        `Hi there,`,
        ``,
        `We've received your return request for order ${orderRef}.`,
        `We'll process it shortly and follow up by email.`,
        ``,
        `— Ceedmart`,
      ].join("\n")
    },
  },

  // ── Return Received ──
  {
    event: "order.return_received",
    channel: "email",
    subject: "Your return has been received",
    template: "return-received",
    entity: "order",
    fields: ["id", "email", "display_id"],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.order?.display_id ? `#${data.order.display_id}` : ""
      return [
        `Hi there,`,
        ``,
        `We've received your returned items for order ${orderRef}.`,
        `Your refund will be processed shortly.`,
        ``,
        `— Ceedmart`,
      ].join("\n")
    },
  },

  // ── Payment Captured ──
  {
    event: "payment.captured",
    channel: "email",
    subject: "Payment confirmed for your Ceedmart order",
    template: "payment-captured",
    getTo: (data) => data.email,
    getBody: () =>
      [
        `Hi there,`,
        ``,
        `Your payment has been successfully captured.`,
        `Thank you for shopping with Ceedmart!`,
        ``,
        `— Ceedmart`,
      ].join("\n"),
  },

  // ── Payment Refunded ──
  {
    event: "payment.refunded",
    channel: "email",
    subject: "Your Ceedmart refund has been processed",
    template: "payment-refunded",
    getTo: (data) => data.email,
    getBody: () =>
      [
        `Hi there,`,
        ``,
        `Your refund has been processed. It may take a few business days`,
        `to appear in your account.`,
        ``,
        `— Ceedmart`,
      ].join("\n"),
  },

  // ── Customer Created (Welcome) ──
  {
    event: "customer.created",
    channel: "email",
    subject: "Welcome to Ceedmart!",
    template: "customer-welcome",
    entity: "customer",
    fields: ["id", "email", "first_name", "last_name", "phone"],
    getTo: (data) => data.email,
    getBody: (data) =>
      [
        `Hi ${data.first_name || "there"},`,
        ``,
        `Thank you for creating an account with us. Start shopping now at`,
        `${STOREFRONT_URL}`,
        ``,
        `— Ceedmart`,
      ].join("\n"),
  },
  {
    event: "customer.created",
    channel: "sms",
    template: "customer-welcome-sms",
    entity: "customer",
    fields: ["id", "first_name", "phone"],
    getTo: (data) => data.phone,
    getBody: () => "",
    getSmsBody: (data) =>
      `Welcome to Ceedmart, ${data.first_name || ""}! Your account is ready. Start shopping now.`,
  },

  // ── Password Reset ──
  {
    event: "auth.password_reset",
    channel: "email",
    subject: "Reset your Ceedmart password",
    template: "password-reset",
    getTo: (data) => data.entity_id,
    // A link, not a raw token. This used to print the JWT as text and ask
    // the customer to "use this token", with nowhere to use it — there was
    // no reset page, and pasting a 255-character string into a form is not
    // a recovery flow anyone completes.
    getBody: (data) =>
      [
        `Hi there,`,
        ``,
        `You asked to reset your Ceedmart password. Open this link to choose`,
        `a new one:`,
        ``,
        resetPasswordUrl(data.token),
        ``,
        `The link expires shortly and can only be used once.`,
        ``,
        `If you didn't ask for this, you can ignore this email — nothing has`,
        `changed on your account.`,
        ``,
        `— Ceedmart`,
      ].join("\n"),
  },

  // ── Invite Created ──
  {
    event: "invite.created",
    channel: "email",
    subject: "You've been invited to Ceedmart",
    template: "invite-created",
    getTo: (data) => data.email,
    getBody: () =>
      [
        `Hi there,`,
        ``,
        `You've been invited to join Ceedmart as a team member.`,
        `Use your invite token to complete registration.`,
        ``,
        `— Ceedmart`,
      ].join("\n"),
  },

  // ── Order Transfer Requested ──
  {
    event: "order.transfer_requested",
    channel: "email",
    subject: "Order transfer requested",
    template: "order-transfer",
    entity: "order",
    fields: ["id", "email", "display_id"],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.display_id ? `#${data.display_id}` : data.id
      return [
        `Hi there,`,
        ``,
        `A transfer has been requested for order ${orderRef}.`,
        ``,
        `— Ceedmart`,
      ].join("\n")
    },
  },
]

// Group handlers by event
const handlersByEvent = handlers.reduce(
  (acc: Record<string, NotificationHandler[]>, h) => {
    if (!acc[h.event]) {
      acc[h.event] = []
    }
    acc[h.event].push(h)
    return acc
  },
  {}
)

export default async function ceedmartNotifications({
  event,
  container,
}: SubscriberArgs<any>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const notificationService: INotificationModuleService = container.resolve(
    Modules.NOTIFICATION
  )

  const eventHandlers = handlersByEvent[event.name] ?? []
  const payload = event.data

  // Resolve entity data once per unique entity type
  const entityCache = new Map<string, any[]>()

  for (const handler of eventHandlers) {
    try {
      // Keyed on the field list too: handlers on the same event ask for
      // different fields, and sharing the first handler's fetch left the
      // others reading fields that were never loaded.
      const cacheKey = `${handler.entity || "__raw__"}:${(handler.fields ?? []).join(",")}`
      let entities: any[]

      if (entityCache.has(cacheKey)) {
        entities = entityCache.get(cacheKey)!
      } else {
        entities = await resolveEntityData(payload, handler, container)
        entityCache.set(cacheKey, entities)
      }

      for (const entity of entities) {
        if (handler.skipWhen?.(entity)) {
          logger.info(
            `[Ceedmart] Skipping ${event.name} (${handler.channel}) for ${entity?.id ?? "?"} — ${handler.skipReason ?? "not an online order"}`
          )
          continue
        }

        const raw = handler.getTo(entity)
        const recipients = (Array.isArray(raw) ? raw : [raw]).filter(
          (r): r is string => !!r
        )
        if (!recipients.length) {
          logger.warn(
            `[Ceedmart] No recipient for ${event.name} (${handler.channel}), skipping`
          )
          continue
        }

        const content: any = {}
        if (handler.channel === "email") {
          // Pulse Pay treats the body as plain text inside its own template;
          // sending under `text` (with `html` mirroring it) keeps SDK type
          // happy and works whichever field the provider reads.
          const body = handler.getBody(entity)
          content.subject =
            handler.getSubject?.(entity) || handler.subject || handler.template
          content.text = body
          content.html = body
        } else if (handler.channel === "sms") {
          content.text = handler.getSmsBody
            ? handler.getSmsBody(entity)
            : handler.getBody(entity)
        }

        // One notification per recipient, each on its own: a bad number
        // must not stop the next one from hearing about the order.
        for (const to of recipients) {
          try {
            await notificationService.createNotifications({
              template: handler.template,
              channel: handler.channel,
              to,
              trigger_type: handler.event,
              resource_id: entity?.id || "",
              content,
            } as any)
            logger.info(
              `[Ceedmart] Sent ${handler.channel} notification for ${event.name} to ${to}`
            )
          } catch (err: any) {
            logger.error(
              `[Ceedmart] Failed to send ${handler.channel} for ${event.name} to ${to}: ${err.message}`
            )
          }
        }
      }
    } catch (err: any) {
      logger.error(
        `[Ceedmart] Failed to send ${handler.channel} for ${event.name}: ${err.message}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: [...new Set(handlers.map((h) => h.event))],
  context: {
    subscriberId: "ceedmart-notifications-handler",
  },
}
