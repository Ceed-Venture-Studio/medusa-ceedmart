import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

/**
 * Upstream Medusa core ships a few admin-facing feed notifications (e.g. the
 * product-import success/failure notifications) with `to: ""` hard-coded —
 * see packages/core/core-flows/src/product/workflows/import-products-as-chunks.ts.
 *
 * Without a recipient, the admin bell shows the message but no per-admin
 * routing. This subscriber re-emits one targeted copy per active admin user
 * so each admin gets the notification surfaced under their own identity.
 *
 * Recursion is prevented via a `fanned_out: true` marker we stamp on the
 * children — the subscriber fires for those creations too, but bails out at
 * the marker check.
 */
export default async function adminFeedFanout({
  event,
  container,
}: SubscriberArgs<{ id: string | string[] }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const notificationService: INotificationModuleService = container.resolve(
    Modules.NOTIFICATION
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const ids = Array.isArray(event.data?.id)
    ? event.data.id
    : [event.data?.id].filter(Boolean)
  if (!ids.length) return

  // The notification module's list filters don't include id, so go through
  // the graph query to fetch the freshly-created notification rows by id.
  const { data: notifications } = await query.graph({
    entity: "notification",
    fields: ["id", "to", "channel", "template", "receiver_id", "trigger_type", "resource_id", "resource_type", "data"],
    filters: { id: ids as string[] },
  })

  const candidates = notifications.filter(
    (n: any) =>
      n.channel === "feed" &&
      n.template === "admin-ui" &&
      !n.to &&
      !n.receiver_id &&
      !(n.data && (n.data as any).fanned_out)
  )
  if (!candidates.length) return

  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "email"],
    pagination: { skip: 0, take: 1000 },
  })
  if (!users.length) {
    logger.warn("[admin-feed-fanout] No admin users found to fan out to")
    return
  }

  for (const orig of candidates) {
    const fanouts = users.map((u: any) => ({
      to: u.id,
      receiver_id: u.id,
      channel: "feed",
      template: "admin-ui",
      trigger_type: orig.trigger_type ?? null,
      resource_id: orig.resource_id ?? null,
      resource_type: orig.resource_type ?? null,
      data: { ...(orig.data || {}), fanned_out: true, original_id: orig.id },
    }))

    try {
      await notificationService.createNotifications(fanouts as any)
      logger.info(
        `[admin-feed-fanout] Fanned ${orig.id} (${(orig.data as any)?.title ?? "feed"}) to ${users.length} admin user(s)`
      )
    } catch (err: any) {
      logger.error(
        `[admin-feed-fanout] Failed to fan out ${orig.id}: ${err?.message ?? err}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: "notification.notification.created",
  context: { subscriberId: "admin-feed-fanout" },
}
