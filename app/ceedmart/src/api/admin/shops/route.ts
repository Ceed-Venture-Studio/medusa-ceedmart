import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createShop } from "../../../lib/shops/create-shop"

// Admin surface for the Ceedmart multi-store setup. A "shop" is any sales
// channel whose metadata carries `ceedmart.code` — set by the create-shop
// helper. This route lists and creates them; PATCH/DELETE live in [id].

type ShopRow = {
  id: string // sales_channel_id
  name: string
  code: string
  state: string | null
  city: string | null
  address: string | null
  phone: string | null
  stock_location_id: string | null
  sourcing_priority: string[]
  is_disabled: boolean
  created_at: string
  updated_at: string
}

const toRow = (
  channel: any,
  stockLocationId: string | null
): ShopRow => {
  const md = (channel.metadata as any)?.ceedmart ?? {}
  return {
    id: channel.id,
    name: channel.name,
    code: String(md.code ?? ""),
    state: md.state ?? null,
    city: md.city ?? null,
    address: md.address ?? null,
    phone: md.phone ?? null,
    stock_location_id: stockLocationId,
    sourcing_priority: Array.isArray(md.sourcing_priority)
      ? md.sourcing_priority
      : [],
    is_disabled: Boolean(channel.is_disabled),
    created_at: channel.created_at,
    updated_at: channel.updated_at,
  }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: [
      "id",
      "name",
      "is_disabled",
      "metadata",
      "created_at",
      "updated_at",
    ],
    pagination: { skip: 0, take: 200 },
  })

  const shopChannels = channels.filter(
    (c: any) => (c.metadata as any)?.ceedmart?.code
  )

  // Resolve each shop's linked stock location in one shot.
  const { data: locLinks } = await query.graph({
    entity: "sales_channel_locations",
    fields: ["sales_channel_id", "stock_location_id"],
    pagination: { skip: 0, take: 10_000 },
  })
  const locByChannel = new Map<string, string>()
  for (const link of locLinks as any[]) {
    if (!locByChannel.has(link.sales_channel_id)) {
      locByChannel.set(link.sales_channel_id, link.stock_location_id)
    }
  }

  const shops = shopChannels
    .map((c: any) => toRow(c, locByChannel.get(c.id) ?? null))
    .sort((a: ShopRow, b: ShopRow) => a.name.localeCompare(b.name))

  res.json({ shops, count: shops.length })
}

type CreateBody = {
  name: string
  code: string
  state: string
  address?: string | null
  city?: string | null
  phone?: string | null
  sourcing?: string[]
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateBody>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as CreateBody)
  if (!body.name?.trim() || !body.code?.trim() || !body.state?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "name, code, and state are required"
    )
  }

  const result = await createShop(req.scope as any, {
    name: body.name,
    code: body.code,
    state: body.state,
    address: body.address ?? null,
    city: body.city ?? null,
    phone: body.phone ?? null,
    sourcing: Array.isArray(body.sourcing) ? body.sourcing : [],
    createdBy: req.auth_context.actor_id,
  })

  res.status(201).json({ shop: result })
}
