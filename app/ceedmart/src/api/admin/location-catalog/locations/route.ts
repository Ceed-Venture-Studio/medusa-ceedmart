import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  provinceName,
  provinceOfChannelMetadata,
} from "../../../../lib/locations"
import { WEB_PROVINCE_BY_ID } from "../../../../lib/web-locations"

// GET /admin/location-catalog/locations
//
// The states Ceedmart sells in, derived from where it actually sells — the
// web location channels and the PoS shops — so a new shop in a new state
// shows up here with no configuration. Shops whose state text cannot be
// mapped are listed separately so admin can fix the spelling.

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled", "metadata"],
    pagination: { skip: 0, take: 1_000 },
  })
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default"],
  })
  const currencies = ((stores as any[])[0]?.supported_currencies ?? []) as any[]
  const defaultCurrency =
    currencies.find((c) => c.is_default)?.currency_code ?? currencies[0]?.currency_code ?? "ngn"

  const byProvince = new Map<
    string,
    { province: string; name: string; channels: { id: string; name: string }[] }
  >()
  const unmapped: { id: string; name: string; state: string | null }[] = []

  for (const c of channels as any[]) {
    if (c.is_disabled) continue
    const isLocation = c.metadata?.ceedmart_web?.location || c.metadata?.ceedmart?.code
    if (!isLocation) continue
    const province = provinceOfChannelMetadata(c.metadata, WEB_PROVINCE_BY_ID)
    if (!province) {
      unmapped.push({ id: c.id, name: c.name, state: c.metadata?.ceedmart?.state ?? null })
      continue
    }
    const entry = byProvince.get(province) ?? {
      province,
      name: provinceName(province)!,
      channels: [],
    }
    entry.channels.push({ id: c.id, name: c.name })
    byProvince.set(province, entry)
  }

  res.json({
    currency_code: defaultCurrency,
    locations: [...byProvince.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unmapped_channels: unmapped,
  })
}
