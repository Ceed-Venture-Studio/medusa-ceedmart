import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

// Give each till its own branch's address on receipts.
//
// ── Why this exists ─────────────────────────────────────────────────────
// The POS reads the receipt header (address, phone) from the single Medusa
// store's metadata.pos, and writes it back there from its Store settings.
// Every till shares that one store, so saving the address on the Port
// Harcourt till put Port Harcourt's address on Uyo's receipts.
//
// The only thing a till's request says about where it is, is who logged in.
// So a till user is tied to its shop with user.metadata.ceedmart.shop_id
// (the shop's sales channel id), and the shop's own address and phone —
// edited on the admin Shops page — replace the store-wide ones in what that
// user is shown. Users without a shop see the store-wide values unchanged.

export type BranchReceiptAddress = {
  store_address?: string
  store_address_2?: string
  store_phone?: string
}

const ADDRESS_KEYS = ["store_address", "store_address_2", "store_phone"] as const

/** The receipt address for a user's shop, or null when they have none. */
export async function resolveBranchReceiptAddress(
  scope: MedusaContainer,
  userId: string
): Promise<BranchReceiptAddress | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "metadata"],
    filters: { id: userId },
  })
  const shopId = (users[0]?.metadata as any)?.ceedmart?.shop_id
  if (typeof shopId !== "string" || !shopId) return null

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "metadata"],
    filters: { id: shopId },
  })
  const md = (channels[0]?.metadata as any)?.ceedmart
  if (!md?.code) return null

  const address: BranchReceiptAddress = {}
  if (md.address) {
    address.store_address = md.address
    // Line 2 is the city and state when the shop has them; otherwise empty,
    // so the store-wide line 2 never trails another branch's street.
    address.store_address_2 =
      [md.city, md.state].filter(Boolean).join(", ") || undefined
  }
  if (md.phone) address.store_phone = md.phone

  return Object.keys(address).length ? address : null
}

/** Store metadata with the branch values laid over metadata.pos. */
export function withBranchAddress(
  metadata: Record<string, unknown> | null | undefined,
  branch: BranchReceiptAddress
): Record<string, unknown> {
  const md = metadata ?? {}
  const pos = { ...((md.pos as Record<string, unknown>) ?? {}) }
  if (branch.store_address !== undefined) {
    pos.store_address = branch.store_address
    pos.store_address_2 = branch.store_address_2
  }
  if (branch.store_phone !== undefined) pos.store_phone = branch.store_phone
  return { ...md, pos }
}

/**
 * metadata.pos from a till's save, with the address fields put back to what
 * is stored. A till tied to a shop shows its branch address, so saving its
 * settings would otherwise write that branch address store-wide.
 */
export function keepStoredAddress(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const storedPos = ((stored ?? {}).pos as Record<string, unknown>) ?? {}
  const pos = { ...((incoming.pos as Record<string, unknown>) ?? {}) }
  for (const key of ADDRESS_KEYS) {
    if (storedPos[key] === undefined) delete pos[key]
    else pos[key] = storedPos[key]
  }
  return { ...incoming, pos }
}
