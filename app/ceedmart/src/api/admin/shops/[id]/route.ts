import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { updateSalesChannelsWorkflow } from "@medusajs/core-flows"

// Get, update, and disable a specific shop. The `id` here is the sales
// channel id — that's the primary identifier for a shop. We update the
// metadata block and (optionally) the channel's display name in place.

type PatchBody = {
  name?: string
  state?: string
  address?: string | null
  city?: string | null
  phone?: string | null
  sourcing?: string[]
  // If true, disables the sales channel — soft-removes the shop from POS
  // + storefront routing without deleting orders/inventory that reference
  // it. Set false to re-enable.
  is_disabled?: boolean
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
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
    filters: { id },
  })
  const channel = channels[0]
  if (!channel) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shop ${id} not found`)
  }
  const md = (channel.metadata as any)?.ceedmart
  if (!md?.code) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Sales channel ${id} is not a Ceedmart shop`
    )
  }

  const { data: locLinks } = await query.graph({
    entity: "sales_channel_locations",
    fields: ["stock_location_id"],
    filters: { sales_channel_id: id },
  })

  res.json({
    shop: {
      id: channel.id,
      name: channel.name,
      code: md.code,
      state: md.state ?? null,
      city: md.city ?? null,
      address: md.address ?? null,
      phone: md.phone ?? null,
      stock_location_id: locLinks[0]?.stock_location_id ?? null,
      sourcing_priority: Array.isArray(md.sourcing_priority)
        ? md.sourcing_priority
        : [],
      is_disabled: Boolean(channel.is_disabled),
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    },
  })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<PatchBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as PatchBody)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "metadata", "is_disabled"],
    filters: { id },
  })
  const channel = channels[0]
  if (!channel) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shop ${id} not found`)
  }
  const existingMd = ((channel.metadata as any) ?? {}) as Record<string, any>
  const existingCeedmart = (existingMd.ceedmart ?? {}) as Record<string, any>
  if (!existingCeedmart.code) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Sales channel ${id} is not a Ceedmart shop`
    )
  }

  const nextCeedmart: Record<string, any> = { ...existingCeedmart }
  if (body.state !== undefined) nextCeedmart.state = body.state.trim() || null
  if (body.address !== undefined) nextCeedmart.address = body.address?.trim() || null
  if (body.city !== undefined) nextCeedmart.city = body.city?.trim() || null
  if (body.phone !== undefined) nextCeedmart.phone = body.phone?.trim() || null

  if (body.sourcing !== undefined) {
    // Force the shop's own stock_location to stay first in the priority
    // list — reordering shouldn't accidentally deprioritise self.
    const { data: locLinks } = await query.graph({
      entity: "sales_channel_locations",
      fields: ["stock_location_id"],
      filters: { sales_channel_id: id },
    })
    const self = locLinks[0]?.stock_location_id
    const rest = body.sourcing
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((sid) => sid !== self)
    nextCeedmart.sourcing_priority = self ? [self, ...rest] : rest
  }

  const update: Record<string, any> = {
    metadata: { ...existingMd, ceedmart: nextCeedmart },
  }
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.is_disabled !== undefined) update.is_disabled = Boolean(body.is_disabled)

  await updateSalesChannelsWorkflow(req.scope).run({
    input: { selector: { id }, update },
  })

  res.json({ ok: true, id })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  // Soft-disable rather than delete so historical orders + inventory that
  // reference the sales channel keep resolving. Ops can re-enable later.
  const { id } = req.params
  await updateSalesChannelsWorkflow(req.scope).run({
    input: { selector: { id }, update: { is_disabled: true } },
  })
  res.json({ ok: true, id, disabled: true })
}
