import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BANNER_MODULE } from "../../../modules/banner"
import { isValidSlotKey } from "../../../lib/banner/slots"

type CreateBody = {
  name: string
  slot: string
  image_url: string
  image_key?: string | null
  image_width: number
  image_height: number
  image_mime_type: string
  link_url?: string | null
  alt_text?: string | null
  starts_at?: string | null
  ends_at?: string | null
  priority?: number
  status?: "draft" | "active" | "archived"
  sales_channel_id?: string | null
  metadata?: Record<string, any> | null
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const slot = req.query.slot as string | undefined
  const status = req.query.status as string | undefined
  const q = (req.query.q as string | undefined)?.trim()
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const filters: Record<string, any> = {}
  if (slot) filters.slot = slot
  if (status) filters.status = status
  if (q) filters.name = { $ilike: `%${q}%` }

  const svc: any = req.scope.resolve(BANNER_MODULE)
  const [banners, count] = await svc.listAndCountBanners(filters, {
    take: limit,
    skip: offset,
    order: { priority: "DESC", created_at: "DESC" },
  })
  res.json({ banners, count, limit, offset })
}

export const POST = async (req: AuthenticatedMedusaRequest<CreateBody>, res: MedusaResponse) => {
  const body = req.body || ({} as CreateBody)
  if (!body.name?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required")
  }
  if (!isValidSlotKey(body.slot)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown slot "${body.slot}"`)
  }
  if (!body.image_url || !body.image_width || !body.image_height) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "image_url, image_width, and image_height are required (upload via POST /admin/banners/upload first)"
    )
  }

  const svc: any = req.scope.resolve(BANNER_MODULE)
  const banner = await svc.createBanners({
    name: body.name.trim(),
    slot: body.slot,
    image_url: body.image_url,
    image_key: body.image_key ?? null,
    image_width: body.image_width,
    image_height: body.image_height,
    image_mime_type: body.image_mime_type,
    link_url: body.link_url?.trim() || null,
    alt_text: body.alt_text?.trim() || null,
    starts_at: body.starts_at ? new Date(body.starts_at) : null,
    ends_at: body.ends_at ? new Date(body.ends_at) : null,
    priority: body.priority ?? 0,
    status: body.status ?? "draft",
    sales_channel_id: body.sales_channel_id ?? null,
    metadata: body.metadata ?? null,
  })
  res.status(201).json({ banner })
}
