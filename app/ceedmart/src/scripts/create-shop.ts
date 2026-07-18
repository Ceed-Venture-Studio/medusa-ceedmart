import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createShop } from "../lib/shops/create-shop"

// CLI wrapper for the shared shop-provisioning helper. Useful for scripted
// setup (initial multi-store rollout, disaster recovery) and for pointing
// at prod DB via env vars without needing an admin session.
//
// Usage:
//   SHOP_NAME="Store 3" SHOP_CODE=store-3 SHOP_STATE=lagos \
//     yarn medusa exec ./src/scripts/create-shop.ts
//
// Env vars:
//   SHOP_NAME      Display name (required)
//   SHOP_CODE      Short slug used in API key name (required, e.g. "store-2")
//   SHOP_STATE     Nigerian state slug for later sourcing rules (required)
//   SHOP_ADDRESS   Street address (optional)
//   SHOP_CITY      City name (optional)
//   SHOP_PHONE     Store phone number (optional)
//   SHOP_SOURCING  Comma-separated stock_location IDs, priority order
//                  (optional; self is prepended and deduped)
//   SHOP_ADMIN_ID  Actor id credited on the API key create (optional)

const required = (key: string): string => {
  const v = process.env[key]
  if (!v || !v.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${key} env var is required`
    )
  }
  return v.trim()
}
const optional = (key: string): string | null => {
  const v = process.env[key]
  return v && v.trim() ? v.trim() : null
}

export default async function createShopScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const sourcingCsv = optional("SHOP_SOURCING") || ""
  const sourcing = sourcingCsv.split(",").map((s) => s.trim()).filter(Boolean)

  const result = await createShop(container, {
    name: required("SHOP_NAME"),
    code: required("SHOP_CODE"),
    state: required("SHOP_STATE"),
    address: optional("SHOP_ADDRESS"),
    city: optional("SHOP_CITY"),
    phone: optional("SHOP_PHONE"),
    sourcing,
    createdBy: optional("SHOP_ADMIN_ID") ?? undefined,
  })

  logger.info(`\n[create-shop] Done. Save these for the shop's POS device:\n`)
  console.log(
    JSON.stringify(
      {
        sales_channel_id: result.sales_channel_id,
        stock_location_id: result.stock_location_id,
        publishable_api_key: result.publishable_api_key_token,
        sourcing_priority: result.sourcing_priority,
      },
      null,
      2
    )
  )
  console.log("")

  if (result.sourcing_priority.length === 1) {
    logger.warn(
      `[create-shop] sourcing_priority contains only the shop's own ` +
        `location. Update it later via /admin/shops/${result.sales_channel_id} ` +
        `or by editing sales_channel.metadata.ceedmart.sourcing_priority.`
    )
  }
}
