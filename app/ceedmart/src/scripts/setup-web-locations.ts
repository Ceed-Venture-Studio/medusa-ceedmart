import {
  createSalesChannelsWorkflow,
  linkProductsToSalesChannelWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateSalesChannelsWorkflow,
} from "@medusajs/core-flows"
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  WEB_LOCATIONS,
  WEB_LOCATION_METADATA_KEY,
  getDefaultSalesChannelId,
  webLocationOf,
} from "../lib/web-locations"

// One-off setup for the per-location web catalog (see lib/web-locations).
//
// For each location in WEB_LOCATIONS this makes sure a "Web – <name>" sales
// channel exists, linked to:
//   - the default channel's stock location(s), so stock counts as before;
//   - the storefront's publishable key, so the storefront may query it.
// A channel created by this run is also given every product currently in the
// default channel, so nothing disappears on day one. An existing channel's
// products are never touched — re-running cannot undo exclusions made in
// admin.
//
// Previews only, unless APPLY=true.
//
// Usage:
//   STOREFRONT_PUBLISHABLE_KEY=pk_... yarn medusa exec ./src/scripts/setup-web-locations.ts
//   APPLY=true STOREFRONT_PUBLISHABLE_KEY=pk_... yarn medusa exec ./src/scripts/setup-web-locations.ts
//
// STOREFRONT_PUBLISHABLE_KEY is the storefront's NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY.

const PAGE = 500

export default async function setupWebLocations({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const apply = process.env.APPLY === "true"
  const token = (process.env.STOREFRONT_PUBLISHABLE_KEY || "").trim()

  if (!token) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "STOREFRONT_PUBLISHABLE_KEY env var is required (the storefront's publishable key)"
    )
  }

  const log = (msg: string) => logger.info(`[web-locations] ${msg}`)
  log(apply ? "APPLY mode — changes will be written" : "Preview only (set APPLY=true to write)")

  // ── The storefront key ───────────────────────────────────────────────
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "type", "revoked_at", "sales_channels.id"],
    filters: { token },
  })
  const key: any = (keys as any[])[0]
  if (!key || key.type !== "publishable" || key.revoked_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active publishable key matches STOREFRONT_PUBLISHABLE_KEY"
    )
  }
  const keyChannelIds = new Set<string>(
    (key.sales_channels ?? []).map((c: any) => c.id)
  )
  log(`Storefront key: "${key.title}" (${keyChannelIds.size} channel(s))`)

  // ── The default channel, its stock locations and products ────────────
  const defaultChannelId = await getDefaultSalesChannelId(container)
  if (!defaultChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "The store has no default sales channel"
    )
  }
  if (!keyChannelIds.has(defaultChannelId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The storefront key is not linked to the default sales channel — refusing to continue"
    )
  }

  const { data: defaults } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "stock_locations.id", "stock_locations.name"],
    filters: { id: defaultChannelId },
  })
  const defaultChannel: any = (defaults as any[])[0]
  const stockLocations: { id: string; name: string }[] =
    defaultChannel.stock_locations ?? []
  log(
    `Default channel: "${defaultChannel.name}" → stock from ${
      stockLocations.map((l) => l.name).join(", ") || "(none)"
    }`
  )

  const defaultProductIds: string[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data: links } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: { sales_channel_id: defaultChannelId },
      pagination: { skip, take: PAGE },
    })
    defaultProductIds.push(...(links as any[]).map((l) => l.product_id))
    if ((links as any[]).length < PAGE) break
  }
  log(`Default channel has ${defaultProductIds.length} product(s)`)

  // ── Existing web-location channels ───────────────────────────────────
  const { data: allChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "metadata", "stock_locations.id"],
  })

  for (const location of WEB_LOCATIONS) {
    let channel: any = (allChannels as any[]).find(
      (c) => webLocationOf(c) === location.id
    )
    const created = !channel

    if (created) {
      log(`${location.name}: create channel "Web – ${location.name}"`)
      if (apply) {
        const {
          result: [sc],
        } = await createSalesChannelsWorkflow(container).run({
          input: {
            salesChannelsData: [
              {
                name: `Web – ${location.name}`,
                description: `Ceedmart website catalog for ${location.name}`,
              },
            ],
          },
        })
        await updateSalesChannelsWorkflow(container).run({
          input: {
            selector: { id: sc.id },
            update: {
              metadata: {
                [WEB_LOCATION_METADATA_KEY]: { location: location.id },
              },
            },
          },
        })
        channel = { id: sc.id, stock_locations: [] }
      }
    } else {
      log(`${location.name}: channel exists (${channel.id}), products left as they are`)
    }

    const linkedLocationIds = new Set<string>(
      (channel?.stock_locations ?? []).map((l: any) => l.id)
    )
    for (const stockLocation of stockLocations) {
      if (linkedLocationIds.has(stockLocation.id)) continue
      log(`${location.name}: link stock location "${stockLocation.name}"`)
      if (apply) {
        await linkSalesChannelsToStockLocationWorkflow(container).run({
          input: { id: stockLocation.id, add: [channel.id] },
        })
      }
    }

    if (!channel || !keyChannelIds.has(channel.id)) {
      log(`${location.name}: link to storefront key "${key.title}"`)
      if (apply) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: key.id, add: [channel.id] },
        })
      }
    }

    if (created) {
      log(`${location.name}: add all ${defaultProductIds.length} default-channel product(s)`)
      if (apply) {
        for (let i = 0; i < defaultProductIds.length; i += PAGE) {
          await linkProductsToSalesChannelWorkflow(container).run({
            input: { id: channel.id, add: defaultProductIds.slice(i, i + PAGE) },
          })
        }
      }
    }
  }

  log(apply ? "Done." : "Preview complete — nothing was written.")
}
