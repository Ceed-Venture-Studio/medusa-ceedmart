import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { BANNER_MODULE } from "../../../../modules/banner"
import { isValidSlotKey } from "../../../../lib/banner/slots"
import { deleteBannerImage } from "../../../../lib/banner/upload"

// Banner images live in their own bucket (lib/banner/upload), not behind
// Medusa's file module, so they are removed through the same client that
// wrote them. Best-effort: an orphaned file costs pennies, a failed save
// costs a campaign.
const removeImages = async (req: AuthenticatedMedusaRequest<any>, keys: (string | null | undefined)[]) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  for (const key of keys) {
    if (!key) continue
    try {
      await deleteBannerImage(key)
    } catch (err: any) {
      logger.warn(`[banners] could not delete image ${key}: ${err?.message ?? err}`)
    }
  }
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banner = await svc.retrieveBanner(id).catch(() => null)
  if (!banner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Banner ${id} not found`)
  }
  res.json({ banner })
}

type ImageFields = {
  url: string
  key?: string | null
  width: number
  height: number
  mime_type: string
}

type PatchBody = {
  name?: string
  slot?: string
  /** Replace the desktop image (from POST /admin/banners/upload). */
  image?: ImageFields
  /** Replace the mobile image; null removes it. */
  mobile_image?: ImageFields | null
  link_url?: string | null
  cta_1_label?: string | null
  cta_2_url?: string | null
  cta_2_label?: string | null
  eyebrow?: string | null
  headline?: string | null
  headline_highlight?: string | null
  subheadline?: string | null
  primary_color?: string | null
  secondary_color?: string | null
  alt_text?: string | null
  starts_at?: string | null
  ends_at?: string | null
  priority?: number
  status?: "draft" | "active" | "archived"
  sales_channel_id?: string | null
  metadata?: Record<string, any> | null
}

export const PATCH = async (req: AuthenticatedMedusaRequest<PatchBody>, res: MedusaResponse) => {
  const { id } = req.params
  const body = req.body || ({} as PatchBody)

  if (body.slot && !isValidSlotKey(body.slot)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown slot "${body.slot}"`)
  }

  const svc: any = req.scope.resolve(BANNER_MODULE)
  const existing = await svc.retrieveBanner(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Banner ${id} not found`)
  }

  const update: Record<string, any> = { id }
  const replacedKeys: (string | null)[] = []
  if (body.image) {
    update.image_url = body.image.url
    update.image_key = body.image.key ?? null
    update.image_width = body.image.width
    update.image_height = body.image.height
    update.image_mime_type = body.image.mime_type
    if (existing.image_key && existing.image_key !== body.image.key) {
      replacedKeys.push(existing.image_key)
    }
  }
  if (body.mobile_image !== undefined) {
    const m = body.mobile_image
    update.mobile_image_url = m?.url ?? null
    update.mobile_image_key = m?.key ?? null
    update.mobile_image_width = m?.width ?? null
    update.mobile_image_height = m?.height ?? null
    update.mobile_image_mime_type = m?.mime_type ?? null
    if (existing.mobile_image_key && existing.mobile_image_key !== m?.key) {
      replacedKeys.push(existing.mobile_image_key)
    }
  }
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.slot !== undefined) update.slot = body.slot
  if (body.link_url !== undefined) update.link_url = body.link_url?.trim() || null
  if (body.cta_1_label !== undefined) update.cta_1_label = body.cta_1_label?.trim() || null
  if (body.cta_2_url !== undefined) update.cta_2_url = body.cta_2_url?.trim() || null
  if (body.cta_2_label !== undefined) update.cta_2_label = body.cta_2_label?.trim() || null
  if (body.eyebrow !== undefined) update.eyebrow = body.eyebrow?.trim() || null
  if (body.headline !== undefined) update.headline = body.headline?.trim() || null
  if (body.headline_highlight !== undefined) update.headline_highlight = body.headline_highlight?.trim() || null
  if (body.subheadline !== undefined) update.subheadline = body.subheadline?.trim() || null
  if (body.primary_color !== undefined) update.primary_color = body.primary_color?.trim() || null
  if (body.secondary_color !== undefined) update.secondary_color = body.secondary_color?.trim() || null
  if (body.alt_text !== undefined) update.alt_text = body.alt_text?.trim() || null
  if (body.starts_at !== undefined) update.starts_at = body.starts_at ? new Date(body.starts_at) : null
  if (body.ends_at !== undefined) update.ends_at = body.ends_at ? new Date(body.ends_at) : null
  if (body.priority !== undefined) update.priority = body.priority
  if (body.status !== undefined) update.status = body.status
  if (body.sales_channel_id !== undefined) update.sales_channel_id = body.sales_channel_id
  if (body.metadata !== undefined) update.metadata = body.metadata

  const updated = await svc.updateBanners(update)
  await removeImages(req, replacedKeys)
  res.json({ banner: Array.isArray(updated) ? updated[0] : updated })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banner = await svc.retrieveBanner(id).catch(() => null)
  if (!banner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Banner ${id} not found`)
  }

  await svc.deleteBanners(id)
  await removeImages(req, [banner.image_key, banner.mobile_image_key])
  res.json({ id, object: "banner", deleted: true })
}
