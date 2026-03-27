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
    fields: ["id", "email", "display_id", "shipping_address.*"],
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>Thank you for your order!</h1>
       <p>Hi ${data.first_name || "there"},</p>
       <p>Your order <strong>${data.display_id ? "#" + data.display_id : data.id}</strong> has been placed successfully.</p>
       <p>We'll notify you when it ships.</p>
       <p>— Ceedmart</p>`,
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
    fields: ["id", "email", "display_id"],
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>Order Canceled</h1>
       <p>Hi ${data.first_name || "there"},</p>
       <p>Your order <strong>${data.display_id ? "#" + data.display_id : data.id}</strong> has been canceled.</p>
       <p>If you have questions, please contact our support team.</p>
       <p>— Ceedmart</p>`,
  },

  // ── Fulfillment Created (order shipped) ──
  {
    event: "order.fulfillment_created",
    channel: "email",
    subject: "Your Ceedmart order is on its way!",
    template: "order-shipped",
    entity: "order",
    fields: ["id", "email", "display_id", "shipping_address.*"],
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>Your order has shipped!</h1>
       <p>Hi ${data.first_name || "there"},</p>
       <p>Your order <strong>${data.display_id ? "#" + data.display_id : data.id}</strong> has been shipped.</p>
       <p>— Ceedmart</p>`,
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
    getBody: (data) =>
      `<h1>Return Request Received</h1>
       <p>We've received your return request for order <strong>${data.order?.display_id ? "#" + data.order.display_id : ""}</strong>.</p>
       <p>We'll process it shortly.</p>
       <p>— Ceedmart</p>`,
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
    getBody: (data) =>
      `<h1>Return Received</h1>
       <p>We've received your returned items for order <strong>${data.order?.display_id ? "#" + data.order.display_id : ""}</strong>.</p>
       <p>Your refund will be processed shortly.</p>
       <p>— Ceedmart</p>`,
  },

  // ── Payment Captured ──
  {
    event: "payment.captured",
    channel: "email",
    subject: "Payment confirmed for your Ceedmart order",
    template: "payment-captured",
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>Payment Confirmed</h1>
       <p>Your payment has been successfully captured.</p>
       <p>Thank you for shopping with Ceedmart!</p>
       <p>— Ceedmart</p>`,
  },

  // ── Payment Refunded ──
  {
    event: "payment.refunded",
    channel: "email",
    subject: "Your Ceedmart refund has been processed",
    template: "payment-refunded",
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>Refund Processed</h1>
       <p>Your refund has been processed. It may take a few business days to appear in your account.</p>
       <p>— Ceedmart</p>`,
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
      `<h1>Welcome to Ceedmart!</h1>
       <p>Hi ${data.first_name || "there"},</p>
       <p>Thank you for creating an account with us. Start shopping now!</p>
       <p>— Ceedmart</p>`,
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
      `<h1>Password Reset</h1>
       <p>You requested to reset your password.</p>
       <p>Use this token to reset your password: <strong>${data.token}</strong></p>
       <p>If you didn't request this, please ignore this email.</p>
       <p>— Ceedmart</p>`,
  },

  // ── Invite Created ──
  {
    event: "invite.created",
    channel: "email",
    subject: "You've been invited to Ceedmart",
    template: "invite-created",
    getTo: (data) => data.email,
    getBody: (data) =>
      `<h1>You've been invited!</h1>
       <p>You've been invited to join Ceedmart as a team member.</p>
       <p>Use your invite token to complete registration.</p>
       <p>— Ceedmart</p>`,
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
    getBody: (data) =>
      `<h1>Order Transfer Request</h1>
       <p>A transfer has been requested for order <strong>${data.display_id ? "#" + data.display_id : data.id}</strong>.</p>
       <p>— Ceedmart</p>`,
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
          notificationData.content = {
            subject: handler.subject || handler.template,
            html: handler.getBody(entity),
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
