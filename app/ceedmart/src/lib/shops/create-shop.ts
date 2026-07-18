import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateSalesChannelsWorkflow,
} from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

// Shared shop-provisioning primitive. Used by both:
//   - /admin/shops POST route (admin dashboard)
//   - src/scripts/create-shop.ts (CLI for scripted setup / disaster recovery)
//
// A shop in Ceedmart is 1 sales_channel + 1 stock_location + 1 publishable
// API key, linked together, with a metadata blob on the sales channel that
// carries display name, address, sourcing priority, and (optional) receipt
// overrides. Nothing about a specific shop is hardcoded elsewhere.

export type CreateShopInput = {
  name: string
  code: string
  state: string
  address?: string | null
  city?: string | null
  phone?: string | null
  // Priority list of stock_location IDs consulted when the shop's own stock
  // is empty. The shop's own location is prepended automatically and
  // deduped. Empty means "self only".
  sourcing?: string[]
  // Actor id credited on the API key create. If omitted, resolved to the
  // first admin user in the DB.
  createdBy?: string
}

export type CreateShopResult = {
  sales_channel_id: string
  stock_location_id: string
  publishable_api_key_id: string
  publishable_api_key_token: string
  sourcing_priority: string[]
}

const trimOrNull = (v?: string | null): string | null => {
  if (v == null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export async function createShop(
  container: MedusaContainer,
  input: CreateShopInput
): Promise<CreateShopResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const name = input.name.trim()
  const code = input.code.trim()
  const state = input.state.trim()
  if (!name || !code || !state) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "name, code, and state are required"
    )
  }

  const address = trimOrNull(input.address)
  const city = trimOrNull(input.city)
  const phone = trimOrNull(input.phone)

  // Resolve the admin actor used to sign the publishable key create.
  let createdBy = input.createdBy
  if (!createdBy) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: users } = await query.graph({
      entity: "user",
      fields: ["id"],
      pagination: { skip: 0, take: 1 },
    })
    createdBy = users[0]?.id
    if (!createdBy) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No admin user found to attribute the API key to. Create one first."
      )
    }
  }

  logger.info(`[shops] Provisioning "${name}" (${code}) in ${state}`)

  // ── 1. Stock location ────────────────────────────────────────────────
  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name,
          address: address
            ? {
                address_1: address,
                city: city ?? undefined,
                country_code: "ng",
                phone: phone ?? undefined,
              }
            : undefined,
        },
      ],
    },
  })

  // ── 2. Sourcing priority: self prepended, deduped ────────────────────
  const providedSourcing = (input.sourcing || [])
    .map((s) => s.trim())
    .filter(Boolean)
  const sourcingPriority = [
    stockLocation.id,
    ...providedSourcing.filter((id) => id !== stockLocation.id),
  ]

  // ── 3. Sales channel ─────────────────────────────────────────────────
  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name,
          description: `Ceedmart ${name}`,
        },
      ],
    },
  })

  // Metadata isn't part of the create DTO in Medusa v2; set it in a
  // follow-up update. Grouped under `ceedmart.*` so we can extend without
  // polluting the top-level namespace.
  await updateSalesChannelsWorkflow(container).run({
    input: {
      selector: { id: salesChannel.id },
      update: {
        metadata: {
          ceedmart: {
            code,
            state,
            city,
            address,
            phone,
            sourcing_priority: sourcingPriority,
          },
        },
      },
    },
  })

  // ── 4. Link stock location ↔ sales channel ───────────────────────────
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [salesChannel.id],
    },
  })

  // ── 5. Publishable API key + link to channel ─────────────────────────
  const {
    result: [apiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: `Ceedmart POS — ${name}`,
          type: "publishable" as any,
          created_by: createdBy!,
        },
      ],
    },
  })

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: apiKey.id,
      add: [salesChannel.id],
    },
  })

  logger.info(
    `[shops] Provisioned ${salesChannel.id} + ${stockLocation.id} + ${apiKey.id}`
  )

  return {
    sales_channel_id: salesChannel.id,
    stock_location_id: stockLocation.id,
    publishable_api_key_id: apiKey.id,
    publishable_api_key_token: apiKey.token,
    sourcing_priority: sourcingPriority,
  }
}
