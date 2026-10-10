import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  getDefaultSalesChannelId,
  webLocationOf,
} from "../../../lib/web-locations"

// GET /store/web-locations
//
// Maps the storefront's location picker values to sales channel ids, so the
// storefront can ask /store/products for one location's catalog without
// hardcoding ids that differ between environments.
//
// Only channels the calling publishable key can actually query are returned
// (asking /store/products for any other channel is rejected). The default
// channel is returned too: with several channels on the key, a product
// query that wants stock levels must name exactly one, so the storefront
// falls back to it when no location is chosen or the location is unmapped.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const keyChannelIds: string[] =
    (req as any).publishable_key_context?.sales_channel_ids ?? []

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "is_disabled", "metadata"],
    filters: { id: keyChannelIds },
  })

  const locations = (channels as any[])
    .filter((c) => !c.is_disabled && webLocationOf(c))
    .map((c) => ({ id: webLocationOf(c)!, sales_channel_id: c.id }))

  const defaultId = await getDefaultSalesChannelId(req.scope)

  res.json({
    default_sales_channel_id:
      defaultId && keyChannelIds.includes(defaultId)
        ? defaultId
        : keyChannelIds[0] ?? null,
    locations,
  })
}
