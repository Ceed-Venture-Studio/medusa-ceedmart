import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { sendNotification } from "../notifications/send"
import { PREORDER_CUSTOMER_STAGE } from "../state-machine/machines"

// Customer notifications for pre-order milestones (BRD §6.6 "the customer
// receives a notification at every configured material milestone").
//
// ── What counts as material ─────────────────────────────────────────────
// Not every status change. A customer does not need an email when an item
// moves between two internal facilities — they need one when something
// they'd want to know about happens: we started sourcing, it left the US,
// it cleared customs, it's out for delivery, or something went wrong.
//
// Sending on every transition would train customers to ignore the emails,
// which costs us the one that actually matters (the exception).

const STOREFRONT_URL = (
  process.env.STORE_CORS || "https://ceedmart.com"
)
  .split(",")[0]
  .replace(/\/$/, "")

type MilestoneCopy = {
  subject: (ref: string) => string
  body: (ctx: { stage: string; promised: string | null }) => string
}

// Statuses worth interrupting someone for, and what to say.
const MATERIAL: Record<string, MilestoneCopy> = {
  sourcing_confirmed: {
    subject: (ref) => `Your pre-order ${ref} is confirmed`,
    body: ({ promised }) =>
      [
        `Good news — we've confirmed your item is available and started sourcing it.`,
        promised
          ? `Estimated delivery: ${promised}.`
          : `We'll confirm your delivery date shortly.`,
      ].join("\n\n"),
  },
  at_us_facility: {
    subject: (ref) => `Your pre-order ${ref} has arrived at our US facility`,
    body: ({ promised }) =>
      [
        `Your item has reached our US facility and is being prepared for its flight to Nigeria.`,
        promised ? `Still on track for ${promised}.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  },
  in_international_transit: {
    subject: (ref) => `Your pre-order ${ref} is on its way to Nigeria`,
    body: ({ promised }) =>
      [
        `Your item has left the US and is in transit.`,
        promised ? `Estimated delivery: ${promised}.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  },
  customs_clearance: {
    subject: (ref) => `Your pre-order ${ref} is clearing customs`,
    body: () =>
      `Your item has landed in Nigeria and is going through customs. Duty and clearing are already covered by what you paid.`,
  },
  at_nigeria_facility: {
    subject: (ref) => `Your pre-order ${ref} is in Nigeria`,
    body: () =>
      `Your item has cleared customs and is at our Nigerian facility. We'll be in touch to arrange delivery.`,
  },
  out_for_delivery: {
    subject: (ref) => `Your pre-order ${ref} is out for delivery`,
    body: () => `Your item is with the courier and should reach you today.`,
  },
  delivered: {
    subject: (ref) => `Your pre-order ${ref} has been delivered`,
    body: () =>
      `Your item has been delivered. If anything isn't right, reply to this email and we'll sort it out.`,
  },
  delivery_exception: {
    subject: (ref) => `An update on your pre-order ${ref}`,
    body: () =>
      `We've hit a delay getting your item to you. We're working on it and will update you as soon as we have a new date.`,
  },
  unable_to_source: {
    subject: (ref) => `We couldn't source your pre-order ${ref}`,
    body: () =>
      `We're sorry — we haven't been able to source your item. We're arranging a full refund and will confirm once it's on its way.`,
  },
  refund_pending: {
    subject: (ref) => `Your refund for ${ref} is being processed`,
    body: () =>
      `We've started your refund. It usually reaches your account within a few working days.`,
  },
  refunded: {
    subject: (ref) => `Your refund for ${ref} is complete`,
    body: () => `Your refund has been sent. Sorry this one didn't work out.`,
  },
  cancelled: {
    subject: (ref) => `Your pre-order ${ref} has been cancelled`,
    body: () => `Your pre-order has been cancelled.`,
  },
}

export const isMaterialMilestone = (status: string): boolean =>
  Object.prototype.hasOwnProperty.call(MATERIAL, status)

const formatDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/**
 * Notify the customer that a pre-order reached a milestone.
 *
 * Resolves the recipient from the order rather than taking it as an
 * argument, so a call site cannot accidentally email the wrong person.
 * Never throws — a notification failure must not roll back a milestone that
 * physically happened.
 */
export const notifyMilestone = async (
  container: MedusaContainer,
  preorder: any,
  args: {
    status: string
    customerNote?: string | null
    delayReason?: string | null
  }
): Promise<void> => {
  const copy = MATERIAL[args.status]
  if (!copy) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "email"],
      filters: { id: preorder.order_id },
    })

    const order = (orders as any[])[0]
    if (!order?.email) return

    const ref = order.display_id ? `#${order.display_id}` : preorder.order_id
    const stage = PREORDER_CUSTOMER_STAGE[args.status] ?? args.status
    const promised = formatDate(preorder.promised_delivery_date)

    const paragraphs = [copy.body({ stage, promised })]

    // Staff-written notes take precedence over the canned copy — a human
    // who took the trouble to explain a delay knows more than the template.
    if (args.customerNote?.trim()) paragraphs.push(args.customerNote.trim())
    else if (args.delayReason?.trim()) paragraphs.push(args.delayReason.trim())

    if (preorder.tracking_url) {
      paragraphs.push(`Track it here: ${preorder.tracking_url}`)
    }

    paragraphs.push(
      `You can check your order any time at ${STOREFRONT_URL}/track`,
      `— Ceedmart`
    )

    const text = paragraphs.join("\n\n")

    await sendNotification(container, {
      to: order.email,
      channel: "email",
      template: "preorder-milestone",
      triggerType: `preorder.${args.status}`,
      resourceId: preorder.id,
      resourceType: "preorder_order",
      correlationId: preorder.order_id,
      content: {
        subject: copy.subject(ref),
        text,
        html: text.replace(/\n/g, "<br/>"),
      },
    })
  } catch (err: any) {
    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(
        `[preorder] milestone notification for ${preorder.id} failed: ${err?.message ?? err}`
      )
    } catch {
      // Nothing else to do.
    }
  }
}
