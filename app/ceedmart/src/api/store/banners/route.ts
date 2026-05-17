import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BANNER_MODULE } from "../../../modules/banner"
import { isValidSlotKey } from "../../../lib/banner/slots"

// GET /store/banners?slot=home_hero_desktop
// Returns active banners for the slot, optionally scoped to a sales channel
// (derived from the publishable key). Sorted by priority desc.
// Storefront caches with the global 'banners' tag — see storefront-revalidate.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const slot = req.query.slot as string | undefined
  if (!slot) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "slot query param required")
  }
  if (!isValidSlotKey(slot)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown slot "${slot}"`)
  }

  const limit = Math.min(Number(req.query.limit ?? 10), 50)
  const now = new Date()

  const pk = (req as any).publishable_key_context
  const salesChannelId = pk?.sales_channel_ids?.[0] ?? null

  const filters: Record<string, any> = {
    slot,
    status: "active",
    $and: [
      { $or: [{ starts_at: null }, { starts_at: { $lte: now } }] },
      { $or: [{ ends_at: null }, { ends_at: { $gte: now } }] },
    ],
  }
  // Scope to sales channel if specified on the banner; banners with NULL
  // sales_channel_id show in all channels.
  if (salesChannelId) {
    filters.$and.push({
      $or: [{ sales_channel_id: null }, { sales_channel_id: salesChannelId }],
    })
  }

  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banners = await svc.listBanners(filters, {
    take: limit,
    order: { priority: "DESC", created_at: "DESC" },
  })

  // Strip internal fields before returning to the storefront.
  const trimmed = banners.map((b: any) => ({
    id: b.id,
    slot: b.slot,
    image_url: b.image_url,
    image_width: b.image_width,
    image_height: b.image_height,
    link_url: b.link_url,
    alt_text: b.alt_text,
    priority: b.priority,
  }))

  res.json({ banners: trimmed })
}
