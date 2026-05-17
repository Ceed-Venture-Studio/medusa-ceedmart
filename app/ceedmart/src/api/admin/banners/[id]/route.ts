import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { BANNER_MODULE } from "../../../../modules/banner"
import { isValidSlotKey } from "../../../../lib/banner/slots"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banner = await svc.retrieveBanner(id).catch(() => null)
  if (!banner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Banner ${id} not found`)
  }
  res.json({ banner })
}

type PatchBody = {
  name?: string
  slot?: string
  link_url?: string | null
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

  const update: Record<string, any> = { id }
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.slot !== undefined) update.slot = body.slot
  if (body.link_url !== undefined) update.link_url = body.link_url?.trim() || null
  if (body.alt_text !== undefined) update.alt_text = body.alt_text?.trim() || null
  if (body.starts_at !== undefined) update.starts_at = body.starts_at ? new Date(body.starts_at) : null
  if (body.ends_at !== undefined) update.ends_at = body.ends_at ? new Date(body.ends_at) : null
  if (body.priority !== undefined) update.priority = body.priority
  if (body.status !== undefined) update.status = body.status
  if (body.sales_channel_id !== undefined) update.sales_channel_id = body.sales_channel_id
  if (body.metadata !== undefined) update.metadata = body.metadata

  const svc: any = req.scope.resolve(BANNER_MODULE)
  const updated = await svc.updateBanners(update)
  res.json({ banner: Array.isArray(updated) ? updated[0] : updated })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banner = await svc.retrieveBanner(id).catch(() => null)
  if (!banner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Banner ${id} not found`)
  }

  // Best-effort delete of the underlying image from the banners bucket.
  if (banner.image_key) {
    try {
      const fileSvc: any = req.scope.resolve(Modules.FILE)
      await fileSvc.deleteFiles([banner.image_key])
    } catch {
      // Not fatal — orphan files can be swept later.
    }
  }

  await svc.deleteBanners(id)
  res.json({ id, object: "banner", deleted: true })
}
