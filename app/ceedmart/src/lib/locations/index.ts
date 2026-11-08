import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { WEB_PROVINCE_BY_ID } from "../web-locations"

// Where a sale happens, as an ISO 3166-2 subdivision code.
//
// ── Why a state code ────────────────────────────────────────────────────
// Prices and availability differ by state, not by city: a second shop in
// Lagos charges what the first one does. Keying on the state means a new
// city in a state already served needs no setup, and a new state is one row
// in NIGERIAN_STATES rather than a code change.
//
// The value is lower-case ("ng-la"), the format Medusa already uses for
// `province` on tax regions, and the pricing rule attribute is `province`
// for the same reason. Every location-aware read goes through here:
//
//   web location channel  → WEB_LOCATIONS[].province   (storefront, app)
//   POS shop channel      → metadata.ceedmart.state    (free text, mapped)
//   cart                  → metadata.ceedmart.province (set by the client)

/** The pricing rule attribute that carries the state code. */
export const PROVINCE_ATTRIBUTE = "province"

export const NIGERIAN_STATES = [
  { code: "ng-ab", name: "Abia" },
  { code: "ng-ad", name: "Adamawa" },
  { code: "ng-ak", name: "Akwa Ibom" },
  { code: "ng-an", name: "Anambra" },
  { code: "ng-ba", name: "Bauchi" },
  { code: "ng-by", name: "Bayelsa" },
  { code: "ng-be", name: "Benue" },
  { code: "ng-bo", name: "Borno" },
  { code: "ng-cr", name: "Cross River" },
  { code: "ng-de", name: "Delta" },
  { code: "ng-eb", name: "Ebonyi" },
  { code: "ng-ed", name: "Edo" },
  { code: "ng-ek", name: "Ekiti" },
  { code: "ng-en", name: "Enugu" },
  { code: "ng-fc", name: "Federal Capital Territory" },
  { code: "ng-go", name: "Gombe" },
  { code: "ng-im", name: "Imo" },
  { code: "ng-ji", name: "Jigawa" },
  { code: "ng-kd", name: "Kaduna" },
  { code: "ng-kn", name: "Kano" },
  { code: "ng-kt", name: "Katsina" },
  { code: "ng-ke", name: "Kebbi" },
  { code: "ng-ko", name: "Kogi" },
  { code: "ng-kw", name: "Kwara" },
  { code: "ng-la", name: "Lagos" },
  { code: "ng-na", name: "Nasarawa" },
  { code: "ng-ni", name: "Niger" },
  { code: "ng-og", name: "Ogun" },
  { code: "ng-on", name: "Ondo" },
  { code: "ng-os", name: "Osun" },
  { code: "ng-oy", name: "Oyo" },
  { code: "ng-pl", name: "Plateau" },
  { code: "ng-ri", name: "Rivers" },
  { code: "ng-so", name: "Sokoto" },
  { code: "ng-ta", name: "Taraba" },
  { code: "ng-yo", name: "Yobe" },
  { code: "ng-za", name: "Zamfara" },
] as const

export type ProvinceCode = (typeof NIGERIAN_STATES)[number]["code"]

const BY_CODE = new Map<string, string>(
  NIGERIAN_STATES.map((s) => [s.code, s.name])
)

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bstate\b/g, "")
    .replace(/[^a-z]/g, "")

const BY_NAME = new Map<string, string>([
  ...NIGERIAN_STATES.map((s) => [squash(s.name), s.code] as [string, string]),
  // Common ways the capital territory is written on a shop form.
  ["fct", "ng-fc"],
  ["abuja", "ng-fc"],
  ["federalcapitalterritoryabuja", "ng-fc"],
])

export const isProvinceCode = (value: unknown): value is ProvinceCode =>
  typeof value === "string" && BY_CODE.has(value)

export const provinceName = (code: string): string | null =>
  BY_CODE.get(code) ?? null

/**
 * A state code from either a code ("NG-LA", "ng-la") or a state name as
 * typed on the Shops page ("Akwa Ibom", "rivers state", "FCT"). Null when it
 * is neither, so an unrecognised shop falls back to national pricing rather
 * than guessing.
 */
export const normalizeProvince = (value: unknown): ProvinceCode | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const lower = value.trim().toLowerCase()
  if (isProvinceCode(lower)) return lower
  return (BY_NAME.get(squash(value)) as ProvinceCode | undefined) ?? null
}

/**
 * The state a sales channel sells in: a web location channel's configured
 * province, or a POS shop's state. Null for the default channel and any
 * channel that is neither.
 */
export const provinceOfChannelMetadata = (
  metadata: Record<string, any> | null | undefined,
  webProvinceById: Record<string, string>
): ProvinceCode | null => {
  const webLocation = metadata?.ceedmart_web?.location
  if (webLocation) return normalizeProvince(webProvinceById[webLocation])
  const shop = metadata?.ceedmart
  if (shop?.code) return normalizeProvince(shop.state)
  return null
}

export const resolveSalesChannelProvince = async (
  container: MedusaContainer,
  salesChannelId: string | null | undefined
): Promise<ProvinceCode | null> => {
  if (!salesChannelId) return null
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "metadata"],
    filters: { id: salesChannelId },
  })
  return provinceOfChannelMetadata(
    (data as any[])[0]?.metadata,
    WEB_PROVINCE_BY_ID
  )
}

/**
 * The state a cart is priced and checked for.
 *
 * The client's choice wins (metadata.ceedmart.province): web carts sit on
 * the default channel whichever city the shopper picked. Otherwise the
 * cart's own channel decides, which is how a POS shop's cart gets its state.
 */
export const provinceOfCart = async (
  container: MedusaContainer,
  cart: {
    metadata?: Record<string, any> | null
    sales_channel_id?: string | null
  }
): Promise<ProvinceCode | null> =>
  normalizeProvince(cart.metadata?.ceedmart?.province) ??
  (await resolveSalesChannelProvince(container, cart.sales_channel_id))

export const loadCartForProvince = async (
  container: MedusaContainer,
  cartId: string
): Promise<ProvinceCode | null> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "metadata", "sales_channel_id"],
    filters: { id: cartId },
  })
  const cart = (data as any[])[0]
  return cart ? provinceOfCart(container, cart) : null
}
