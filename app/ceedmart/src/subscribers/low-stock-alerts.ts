import {
  ContainerRegistrationKeys,
  InventoryEvents,
  Modules,
} from "@medusajs/framework/utils"
import type {
  ICacheService,
  INotificationModuleService,
  Logger,
} from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

// H6 — Low-stock alerts.
//
// Fires on every inventory_level update. When (stocked - reserved) at a
// location drops below the variant's configured threshold, we email a
// central inbox. Per-variant threshold lives at
// product_variant.metadata.low_stock_threshold; if unset we fall back to
// LOW_STOCK_DEFAULT_THRESHOLD (env, default 5). Zero disables the alert.
//
// A Redis dedupe key (low_stock:<variant_id>:<location_id>) with a 3-day
// TTL suppresses re-alerts for the same SKU/location while stock is still
// low. Once it restocks above threshold the key is cleared so the next
// dip re-alerts immediately.

const DEDUPE_TTL_SECONDS = 3 * 24 * 60 * 60
const DEFAULT_THRESHOLD_ENV = "LOW_STOCK_DEFAULT_THRESHOLD"
const RECIPIENT_ENV = "LOW_STOCK_ALERT_EMAIL"

type Ctx = {
  logger: Logger
  query: any
  cache: ICacheService
  notify: INotificationModuleService
}

const parseThreshold = (raw: unknown): number | null => {
  if (raw == null || raw === "") return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const readDefaultThreshold = (): number => {
  const fromEnv = parseThreshold(process.env[DEFAULT_THRESHOLD_ENV])
  return fromEnv ?? 5
}

const dedupeKey = (variantId: string, locationId: string) =>
  `low_stock:${variantId}:${locationId}`

async function findVariantForLevel(
  ctx: Ctx,
  inventoryItemId: string
): Promise<{ variantId: string; productTitle: string; variantTitle: string | null; sku: string | null } | null> {
  const { data: links } = await ctx.query.graph({
    entity: "product_variant_inventory_item",
    fields: ["variant_id"],
    filters: { inventory_item_id: inventoryItemId },
    pagination: { skip: 0, take: 1 },
  })
  const variantId = (links as any[])[0]?.variant_id
  if (!variantId) return null

  const { data: variants } = await ctx.query.graph({
    entity: "variant",
    fields: [
      "id",
      "title",
      "sku",
      "metadata",
      "product.id",
      "product.title",
    ],
    filters: { id: variantId },
  })
  const v: any = (variants as any[])[0]
  if (!v) return null
  return {
    variantId: v.id,
    productTitle: v.product?.title ?? "(unknown product)",
    variantTitle: v.title ?? null,
    sku: v.sku ?? null,
  }
}

async function loadLevel(ctx: Ctx, levelId: string) {
  const { data: levels } = await ctx.query.graph({
    entity: "inventory_level",
    fields: [
      "id",
      "location_id",
      "inventory_item_id",
      "stocked_quantity",
      "reserved_quantity",
    ],
    filters: { id: levelId },
  })
  return (levels as any[])[0] ?? null
}

async function loadVariantThreshold(
  ctx: Ctx,
  variantId: string
): Promise<number> {
  const { data: variants } = await ctx.query.graph({
    entity: "variant",
    fields: ["id", "metadata"],
    filters: { id: variantId },
  })
  const raw = ((variants as any[])[0]?.metadata as any)?.low_stock_threshold
  const parsed = parseThreshold(raw)
  return parsed ?? readDefaultThreshold()
}

async function loadLocationName(ctx: Ctx, locationId: string): Promise<string> {
  try {
    const { data: locs } = await ctx.query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
      filters: { id: locationId },
    })
    return (locs as any[])[0]?.name ?? locationId
  } catch {
    return locationId
  }
}

async function sendAlert(
  ctx: Ctx,
  args: {
    recipient: string
    productTitle: string
    variantTitle: string | null
    sku: string | null
    locationName: string
    available: number
    threshold: number
  }
) {
  const { recipient, productTitle, variantTitle, sku, locationName, available, threshold } = args
  const variantLine = variantTitle && variantTitle !== productTitle ? ` — ${variantTitle}` : ""
  const skuLine = sku ? ` (SKU ${sku})` : ""
  const body = [
    `Low stock alert:`,
    ``,
    `Product: ${productTitle}${variantLine}${skuLine}`,
    `Location: ${locationName}`,
    `Available: ${available}`,
    `Threshold: ${threshold}`,
    ``,
    `Re-alerts are suppressed for 3 days at this location while stock stays low.`,
    ``,
    `— Ceedmart`,
  ].join("\n")

  await ctx.notify.createNotifications({
    to: recipient,
    channel: "email",
    template: "low-stock-alert",
    content: {
      subject: `Low stock: ${productTitle}${variantLine}`,
      text: body,
      html: body,
    },
  } as any)
}

export default async function lowStockAlertsHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const recipient = (process.env[RECIPIENT_ENV] || "").trim()
  if (!recipient) {
    // Nothing to send to — no work.
    return
  }

  const ctx: Ctx = {
    logger,
    query: container.resolve(ContainerRegistrationKeys.QUERY),
    cache: container.resolve(Modules.CACHE),
    notify: container.resolve(Modules.NOTIFICATION),
  }

  const payload = event.data
  const items = Array.isArray(payload) ? payload : [payload]

  for (const item of items) {
    const levelId = item?.id
    if (!levelId) continue

    try {
      const level = await loadLevel(ctx, levelId)
      if (!level) continue

      const stocked = Number(level.stocked_quantity ?? 0)
      const reserved = Number(level.reserved_quantity ?? 0)
      const available = Math.max(0, stocked - reserved)

      const variantInfo = await findVariantForLevel(ctx, level.inventory_item_id)
      if (!variantInfo) continue

      const threshold = await loadVariantThreshold(ctx, variantInfo.variantId)
      if (threshold <= 0) {
        // Explicit "no alert" for this variant.
        continue
      }

      const key = dedupeKey(variantInfo.variantId, level.location_id)

      if (available >= threshold) {
        // Stock restored — clear the dedupe key so the next dip alerts fresh.
        try {
          await ctx.cache.invalidate(key)
        } catch {
          /* cache errors are non-fatal */
        }
        continue
      }

      // Below threshold — send alert once per 3 days per SKU/location.
      const already = await ctx.cache.get(key).catch(() => null)
      if (already) continue
      await ctx.cache.set(key, "1", DEDUPE_TTL_SECONDS).catch(() => undefined)

      const locationName = await loadLocationName(ctx, level.location_id)
      await sendAlert(ctx, {
        recipient,
        productTitle: variantInfo.productTitle,
        variantTitle: variantInfo.variantTitle,
        sku: variantInfo.sku,
        locationName,
        available,
        threshold,
      })
      logger.info(
        `[low-stock] Alerted ${recipient} for variant ${variantInfo.variantId} at ${locationName} (available=${available}, threshold=${threshold})`
      )
    } catch (err: any) {
      logger.error(`[low-stock] Failed on level ${levelId}: ${err?.message ?? err}`)
    }
  }
}

export const config: SubscriberConfig = {
  event: [InventoryEvents.INVENTORY_LEVEL_UPDATED],
  context: {
    subscriberId: "ceedmart-low-stock-alerts",
  },
}
