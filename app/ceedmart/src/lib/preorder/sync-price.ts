import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertVariantPricesWorkflow } from "@medusajs/core-flows"

// Put the offer's locked price on the variant itself.
//
// ── Why the price has to be real ────────────────────────────────────────
// Showing the pre-order price on the product page is not enough. Medusa
// refuses to add a line item for a variant with no calculated price — the
// cart workflow throws in get-variants-and-items-with-prices before anything
// we control runs. So an item that exists only as a pre-order, with no shelf
// price, cannot be bought at all unless the offer price IS the price.
//
// Writing it here rather than special-casing the storefront also means cart
// totals, taxes, promotions, order lines and the pre-order capture
// subscriber all keep working untouched: they read one price, and it is the
// right one.
//
// ── Precedence ──────────────────────────────────────────────────────────
// The offer price wins over any catalogue price while the offer is live.
// That is the intent — a pre-order is the same item on different commercial
// terms, and quoting the shelf price for something being flown in would
// under-charge by the entire cost of getting it here.
//
// The displaced price is remembered on the listing policy (a JSON column we
// already own and already write) so unpublishing can put it back. Without
// that, publishing an offer over a priced product would destroy the shelf
// price permanently.

const CURRENCY = "ngn"

/** Kobo on the offer, naira in the catalogue. Medusa stores major units. */
const toCatalogAmount = (kobo: number): number => Number(kobo) / 100

const currentPrice = async (
  container: MedusaContainer,
  variantId: string
): Promise<number | null> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: ["id", "prices.amount", "prices.currency_code"],
    filters: { id: variantId },
  })
  const prices = (data as any[])[0]?.prices ?? []
  const match = prices.find(
    (p: any) => String(p.currency_code).toLowerCase() === CURRENCY
  )
  return match ? Number(match.amount) : null
}

const writePrice = async (
  container: MedusaContainer,
  variantId: string,
  productId: string,
  amount: number
): Promise<void> => {
  await upsertVariantPricesWorkflow(container).run({
    input: {
      variantPrices: [
        {
          variant_id: variantId,
          product_id: productId,
          prices: [{ amount, currency_code: CURRENCY }],
        },
      ],
      previousVariantIds: [variantId],
    },
  })
}

/** Remove the variant's prices entirely, returning it to "no price set". */
const clearPrice = async (
  container: MedusaContainer,
  variantId: string,
  productId: string
): Promise<void> => {
  await upsertVariantPricesWorkflow(container).run({
    input: {
      variantPrices: [
        { variant_id: variantId, product_id: productId, prices: [] },
      ],
      previousVariantIds: [variantId],
    },
  })
}

/**
 * Apply the offer's price to its variant, or restore what was there before.
 *
 * Called after the listing policy is synced, so the policy row exists to
 * record the displaced price against.
 *
 * Never throws. A price that fails to sync leaves the offer unbuyable, which
 * is visible and recoverable; taking down the whole publish action because a
 * price write failed is neither.
 */
export const syncOfferPrice = async (
  container: MedusaContainer,
  offer: any,
  policyConfigStore: {
    read: () => Promise<Record<string, any> | null>
    write: (config: Record<string, any>) => Promise<void>
  }
): Promise<void> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Product-level offers have no single variant to price. Rare, and the
  // policy still applies — the listing keeps its own price.
  if (!offer.variant_id) {
    return
  }

  // Offers store a variant and leave product_id null, but the price workflow
  // needs the product to create the variant's price set link. Resolve it.
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variantRows } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id"],
    filters: { id: offer.variant_id },
  })
  const productId = offer.product_id ?? (variantRows as any[])[0]?.product_id
  if (!productId) {
    logger.warn(
      `[preorder] offer ${offer.id} references variant ${offer.variant_id} with no product; cannot price it`
    )
    return
  }

  try {
    const config = (await policyConfigStore.read()) ?? {}
    const active = offer.is_active === true

    if (active) {
      const existing = await currentPrice(container, offer.variant_id)
      const target = toCatalogAmount(offer.locked_price)

      if (existing === target) {
        return
      }

      // Record what we are displacing, once — including that there was
      // NOTHING, which is why null is stored rather than skipped. On
      // unpublish that distinction decides between putting a shelf price
      // back and removing a price that only ever existed for the offer.
      //
      // Only on the first publish: re-recording would capture our own price
      // the second time round and lose the original.
      if (config.displaced_price === undefined) {
        await policyConfigStore.write({ ...config, displaced_price: existing })
      }

      await writePrice(container, offer.variant_id, productId, target)
      logger.info(
        `[preorder] variant ${offer.variant_id} priced at ${target} ${CURRENCY} from offer ${offer.id}`
      )
      return
    }

    // Unpublished: undo whatever publishing did.
    if (config.displaced_price === undefined) {
      return
    }

    if (config.displaced_price === null) {
      // The variant had no price of its own. Leaving the offer price behind
      // would quietly turn a withdrawn pre-order into ordinary stock at the
      // pre-order price.
      await clearPrice(container, offer.variant_id, productId)
      logger.info(
        `[preorder] variant ${offer.variant_id} price removed with offer ${offer.id}`
      )
    } else {
      await writePrice(
        container,
        offer.variant_id,
        productId,
        Number(config.displaced_price)
      )
      logger.info(
        `[preorder] variant ${offer.variant_id} restored to ${config.displaced_price} ${CURRENCY}`
      )
    }

    const { displaced_price, ...rest } = config
    await policyConfigStore.write(rest)
  } catch (err: any) {
    logger.error(
      `[preorder] could not sync the price for offer ${offer.id}: ${err?.message ?? err}`
    )
  }
}
