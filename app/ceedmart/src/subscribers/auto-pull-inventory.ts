import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type {
  IInventoryService,
  INotificationModuleService,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { STOCK_TRANSFER_MODULE } from "../modules/stock-transfer"

// M1 — Cross-warehouse auto-pull.
//
// When an order is placed and the fulfilling location can't cover the
// requested quantity, walk the shop's sourcing_priority list (set on the
// sales channel metadata during shop provisioning) and transfer stock in
// from the first eligible source. Every transfer is recorded in the
// stock_transfer table for audit and shown in the admin. If any transfers
// happen for an order, a single digest email is sent to
// STOCK_TRANSFER_ALERT_EMAIL.
//
// Notes:
//   • Runs after Medusa's own reservation step, so the fulfilling location
//     may already be in a negative-available state — we look at
//     (stocked - reserved) < 0 as the shortfall signal.
//   • Non-fatal: any per-item error is logged and the loop continues, so
//     one bad SKU can't break the whole order flow.
//   • Idempotent-ish: if the same order fires twice we skip items where
//     no shortfall remains, so at worst we no-op.

const ALERT_EMAIL_ENV = "STOCK_TRANSFER_ALERT_EMAIL"

type Ctx = {
  logger: Logger
  query: any
  inventory: IInventoryService
  notify: INotificationModuleService
  transfers: any
}

type Pull = {
  order_id: string
  order_display_id: number | null
  inventory_item_id: string
  variant_id: string | null
  variant_sku: string | null
  product_title: string | null
  from_location_id: string
  to_location_id: string
  from_location_name: string | null
  to_location_name: string | null
  quantity: number
}

const asNumber = (v: unknown): number => {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (v && typeof v === "object" && "value" in (v as any)) {
    const n = Number((v as any).value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

async function loadOrder(ctx: Ctx, orderId: string) {
  const { data: orders } = await ctx.query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "sales_channel_id",
      "items.id",
      "items.variant_id",
      "items.product_title",
      "items.variant_title",
      "items.variant_sku",
      "items.title",
      "items.detail.quantity",
    ],
    filters: { id: orderId },
  })
  return (orders as any[])[0] ?? null
}

async function loadSalesChannel(ctx: Ctx, id: string | null) {
  if (!id) return null
  const { data: channels } = await ctx.query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "metadata"],
    filters: { id },
  })
  return (channels as any[])[0] ?? null
}

async function loadInventoryItemIdForVariant(
  ctx: Ctx,
  variantId: string
): Promise<string | null> {
  const { data: links } = await ctx.query.graph({
    entity: "product_variant_inventory_item",
    fields: ["inventory_item_id"],
    filters: { variant_id: variantId },
    pagination: { skip: 0, take: 1 },
  })
  return (links as any[])[0]?.inventory_item_id ?? null
}

async function loadLevelsForItem(ctx: Ctx, inventoryItemId: string) {
  const { data: levels } = await ctx.query.graph({
    entity: "inventory_level",
    fields: [
      "id",
      "location_id",
      "inventory_item_id",
      "stocked_quantity",
      "reserved_quantity",
    ],
    filters: { inventory_item_id: inventoryItemId },
  })
  return (levels as any[]) ?? []
}

async function loadLocationNames(
  ctx: Ctx,
  ids: string[]
): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const unique = Array.from(new Set(ids))
  try {
    const { data: locs } = await ctx.query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
      filters: { id: unique },
    })
    const out: Record<string, string> = {}
    for (const l of locs as any[]) out[l.id] = l.name
    return out
  } catch {
    return {}
  }
}

function extractSourcingPriority(salesChannel: any, ownLocationId?: string): string[] {
  const meta = salesChannel?.metadata?.ceedmart
  const raw: unknown = meta?.sourcing_priority
  const list = Array.isArray(raw) ? raw.filter((s: any) => typeof s === "string" && s) : []
  // Ensure own location is first when we know it.
  if (ownLocationId && !list.includes(ownLocationId)) {
    return [ownLocationId, ...list]
  }
  return list
}

async function resolveFulfillingLocation(
  ctx: Ctx,
  salesChannel: any
): Promise<string | null> {
  // Sales channel links to one or more stock locations. Prefer the first
  // linked one — this is the shop's own location per the create-shop
  // provisioning.
  const { data: linked } = await ctx.query.graph({
    entity: "sales_channel_location",
    fields: ["stock_location_id"],
    filters: { sales_channel_id: salesChannel.id },
    pagination: { skip: 0, take: 1 },
  })
  return (linked as any[])[0]?.stock_location_id ?? null
}

async function movePull(ctx: Ctx, pull: Pull, sourceLevel: any, targetLevel: any) {
  const newSource = Math.max(0, asNumber(sourceLevel.stocked_quantity) - pull.quantity)
  const newTarget = asNumber(targetLevel.stocked_quantity) + pull.quantity

  await ctx.inventory.updateInventoryLevels([
    {
      inventory_item_id: pull.inventory_item_id,
      location_id: pull.from_location_id,
      stocked_quantity: newSource,
    },
    {
      inventory_item_id: pull.inventory_item_id,
      location_id: pull.to_location_id,
      stocked_quantity: newTarget,
    },
  ] as any)

  await ctx.transfers.createStockTransfers({
    from_location_id: pull.from_location_id,
    to_location_id: pull.to_location_id,
    from_location_name: pull.from_location_name,
    to_location_name: pull.to_location_name,
    inventory_item_id: pull.inventory_item_id,
    variant_id: pull.variant_id,
    variant_sku: pull.variant_sku,
    product_title: pull.product_title,
    quantity: pull.quantity,
    order_id: pull.order_id,
    order_display_id: pull.order_display_id,
    reason: "auto_pull_on_order",
    status: "completed",
  })
}

async function sendDigest(
  ctx: Ctx,
  recipient: string,
  order: { id: string; display_id: number | null },
  pulls: Pull[]
) {
  const ref = order.display_id ? `#${order.display_id}` : order.id
  const lines: string[] = [
    `Stock auto-pull triggered by order ${ref}:`,
    ``,
  ]
  for (const p of pulls) {
    const from = p.from_location_name || p.from_location_id
    const to = p.to_location_name || p.to_location_id
    const item = p.product_title || p.variant_sku || p.inventory_item_id
    const sku = p.variant_sku ? ` (SKU ${p.variant_sku})` : ""
    lines.push(`• ${p.quantity} × ${item}${sku}  ${from} → ${to}`)
  }
  lines.push(``, `— Ceedmart`)

  await ctx.notify.createNotifications({
    to: recipient,
    channel: "email",
    template: "stock-transfer-alert",
    content: {
      subject: `Auto-pull: ${pulls.length} item${pulls.length === 1 ? "" : "s"} moved for order ${ref}`,
      text: lines.join("\n"),
      html: lines.join("\n"),
    },
  } as any)
}

export default async function autoPullInventoryHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  const ctx: Ctx = {
    logger,
    query: container.resolve(ContainerRegistrationKeys.QUERY),
    inventory: container.resolve(Modules.INVENTORY),
    notify: container.resolve(Modules.NOTIFICATION),
    transfers: container.resolve(STOCK_TRANSFER_MODULE),
  }

  try {
    const order = await loadOrder(ctx, orderId)
    if (!order) return

    const salesChannel = await loadSalesChannel(ctx, order.sales_channel_id)
    const fulfillingLocation = salesChannel
      ? await resolveFulfillingLocation(ctx, salesChannel)
      : null
    if (!fulfillingLocation) {
      // Nothing to reason about without a fulfilling location.
      return
    }

    const sourcing = extractSourcingPriority(salesChannel, fulfillingLocation)
    const sources = sourcing.filter((id) => id !== fulfillingLocation)
    if (!sources.length) {
      // Shop has no fallback locations configured.
      return
    }

    const pulls: Pull[] = []

    for (const item of order.items ?? []) {
      const needed = asNumber(item.detail?.quantity ?? item.quantity)
      if (!needed || !item.variant_id) continue

      try {
        const invItemId = await loadInventoryItemIdForVariant(ctx, item.variant_id)
        if (!invItemId) continue

        const levels = await loadLevelsForItem(ctx, invItemId)
        const byLocation = new Map<string, any>(levels.map((l: any) => [l.location_id, l]))

        const targetLevel = byLocation.get(fulfillingLocation)
        if (!targetLevel) continue

        let available =
          asNumber(targetLevel.stocked_quantity) - asNumber(targetLevel.reserved_quantity)
        if (available >= 0) continue // fully covered

        let shortfall = -available

        for (const sourceId of sources) {
          if (shortfall <= 0) break
          const sourceLevel = byLocation.get(sourceId)
          if (!sourceLevel) continue
          const sourceAvailable =
            asNumber(sourceLevel.stocked_quantity) - asNumber(sourceLevel.reserved_quantity)
          if (sourceAvailable <= 0) continue

          const move = Math.min(shortfall, sourceAvailable)
          pulls.push({
            order_id: order.id,
            order_display_id: order.display_id ?? null,
            inventory_item_id: invItemId,
            variant_id: item.variant_id,
            variant_sku: item.variant_sku ?? null,
            product_title: item.product_title ?? item.title ?? null,
            from_location_id: sourceId,
            to_location_id: fulfillingLocation,
            from_location_name: null,
            to_location_name: null,
            quantity: move,
          })
          shortfall -= move
          // Mutate in-memory so a subsequent line item sees updated levels.
          sourceLevel.stocked_quantity = asNumber(sourceLevel.stocked_quantity) - move
          targetLevel.stocked_quantity = asNumber(targetLevel.stocked_quantity) + move
        }
      } catch (err: any) {
        logger.error(
          `[auto-pull] Item ${item.id} (variant ${item.variant_id}): ${err?.message ?? err}`
        )
      }
    }

    if (!pulls.length) return

    // Resolve names for all locations that showed up in the pulls before
    // persisting rows — avoids one query per row.
    const names = await loadLocationNames(
      ctx,
      pulls.flatMap((p) => [p.from_location_id, p.to_location_id])
    )
    for (const p of pulls) {
      p.from_location_name = names[p.from_location_id] ?? null
      p.to_location_name = names[p.to_location_id] ?? null
    }

    // Persist inventory-level changes + stock_transfer rows.
    for (const p of pulls) {
      const levels = await loadLevelsForItem(ctx, p.inventory_item_id)
      const byLocation = new Map<string, any>(levels.map((l: any) => [l.location_id, l]))
      const src = byLocation.get(p.from_location_id)
      const tgt = byLocation.get(p.to_location_id)
      if (!src || !tgt) continue
      try {
        await movePull(ctx, p, src, tgt)
        logger.info(
          `[auto-pull] Order ${order.display_id ?? order.id}: pulled ${p.quantity} × ${p.inventory_item_id} ${p.from_location_id} → ${p.to_location_id}`
        )
      } catch (err: any) {
        logger.error(
          `[auto-pull] Failed to move ${p.quantity} × ${p.inventory_item_id}: ${err?.message ?? err}`
        )
      }
    }

    const recipient = (process.env[ALERT_EMAIL_ENV] || "").trim()
    if (recipient) {
      try {
        await sendDigest(ctx, recipient, { id: order.id, display_id: order.display_id }, pulls)
      } catch (err: any) {
        logger.error(`[auto-pull] Digest email failed: ${err?.message ?? err}`)
      }
    }
  } catch (err: any) {
    logger.error(`[auto-pull] Order ${orderId} failed: ${err?.message ?? err}`)
  }
}

export const config: SubscriberConfig = {
  event: ["order.placed"],
  context: {
    subscriberId: "ceedmart-auto-pull-inventory",
  },
}
