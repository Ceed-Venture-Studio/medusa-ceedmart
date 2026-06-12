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
  template: string
  // Entity type and fields to fetch when event payload only contains IDs
  entity?: string
  fields?: string[]
  getTo: (data: any) => string | undefined
  getBody: (data: any) => string
  getSmsBody?: (data: any) => string
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

const NGN_CURRENCIES = new Set(["ngn", "NGN"])
const formatMoney = (amount: number | string | null | undefined, currency?: string | null): string => {
  const n = typeof amount === "number" ? amount : Number(amount ?? 0)
  if (!Number.isFinite(n)) return "—"
  const cc = (currency || "").toLowerCase()
  if (NGN_CURRENCIES.has(cc)) {
    return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
  }
  if (!cc) return n.toLocaleString()
  return `${n.toLocaleString()} ${cc.toUpperCase()}`
}

const orderViewUrl = (orderId: string): string =>
  `${STOREFRONT_URL}/${STOREFRONT_COUNTRY}/order/${orderId}/confirmed`

const renderItemsList = (items: any[] = [], currency?: string): string => {
  if (!items.length) return ""
  return items
    .map((it: any) => {
      const qty = it.quantity ?? 1
      const title = it.product_title || it.title || "Item"
      const variantBit = it.variant_title && it.variant_title !== it.product_title
        ? ` (${it.variant_title})`
        : ""
      const lineTotal = it.total ?? it.subtotal ?? (qty * (it.unit_price ?? 0))
      return `  • ${qty} × ${title}${variantBit} — ${formatMoney(lineTotal, currency)}`
    })
    .join("\n")
}

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
      "total",
      "subtotal",
      "tax_total",
      "shipping_total",
      "discount_total",
      "currency_code",
      "shipping_address.first_name",
      "items.id",
      "items.title",
      "items.product_title",
      "items.variant_title",
      "items.quantity",
      "items.unit_price",
      "items.total",
      "items.subtotal",
    ],
    getTo: (data) => data.email,
    getBody: (data) => {
      const orderRef = data.display_id ? `#${data.display_id}` : data.id
      const greeting = data.shipping_address?.first_name || "there"
      const itemsBlock = renderItemsList(data.items, data.currency_code)
      const lines: string[] = [
        `Hi ${greeting},`,
        ``,
        `Thank you for your order! Your order ${orderRef} has been placed successfully.`,
      ]

      if (itemsBlock) {
        lines.push(``, `Items:`, itemsBlock)
      }

      const subtotal = data.subtotal
      const shipping = data.shipping_total
      const tax = data.tax_total
      const discount = data.discount_total
      const total = data.total
      lines.push(``, `Summary:`)
      if (subtotal != null) {
        lines.push(`  Subtotal: ${formatMoney(subtotal, data.currency_code)}`)
      }
      if (Number(discount) > 0) {
        lines.push(`  Discount: -${formatMoney(discount, data.currency_code)}`)
      }
      if (Number(shipping) > 0) {
        lines.push(`  Shipping: ${formatMoney(shipping, data.currency_code)}`)
      }
      if (Number(tax) > 0) {
        lines.push(`  Tax: ${formatMoney(tax, data.currency_code)}`)
      }
      lines.push(`  Total: ${formatMoney(total, data.currency_code)}`)

      lines.push(
        ``,
        `View your order: ${orderViewUrl(data.id)}`,
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
    fields: ["id", "display_id", "shipping_address.*", "phone"],
    getTo: (data) => data.shipping_address?.phone || data.phone,
    getBody: () => "",
    getSmsBody: (data) =>
      `Ceedmart: Your order ${data.display_id ? "#" + data.display_id : ""} has been placed! We'll notify you when it ships.`,
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
    fields: ["id", "display_id", "shipping_address.*"],
    getTo: (data) => data.shipping_address?.phone,
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
    getBody: (data) =>
      [
        `Hi there,`,
        ``,
        `You requested to reset your password.`,
        `Use this token to reset it: ${data.token}`,
        ``,
        `If you didn't request this, please ignore this email.`,
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
      const cacheKey = handler.entity || "__raw__"
      let entities: any[]

      if (entityCache.has(cacheKey)) {
        entities = entityCache.get(cacheKey)!
      } else {
        entities = await resolveEntityData(payload, handler, container)
        entityCache.set(cacheKey, entities)
      }

      for (const entity of entities) {
        const to = handler.getTo(entity)
        if (!to) {
          logger.warn(
            `[Ceedmart] No recipient for ${event.name} (${handler.channel}), skipping`
          )
          continue
        }

        const notificationData: any = {
          template: handler.template,
          channel: handler.channel,
          to,
          trigger_type: handler.event,
          resource_id: entity?.id || "",
        }

        if (handler.channel === "email") {
          // Pulse Pay treats the body as plain text inside its own template;
          // sending under `text` (with `html` mirroring it) keeps SDK type
          // happy and works whichever field the provider reads.
          const body = handler.getBody(entity)
          notificationData.content = {
            subject: handler.subject || handler.template,
            text: body,
            html: body,
          }
        } else if (handler.channel === "sms") {
          notificationData.content = {
            text: handler.getSmsBody
              ? handler.getSmsBody(entity)
              : handler.getBody(entity),
          }
        }

        await notificationService.createNotifications(notificationData)
        logger.info(
          `[Ceedmart] Sent ${handler.channel} notification for ${event.name} to ${to}`
        )
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
