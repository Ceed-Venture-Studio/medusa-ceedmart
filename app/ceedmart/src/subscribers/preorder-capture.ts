import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { PREORDER_MODULE } from "../modules/preorder"
import { LISTING_POLICY_MODULE } from "../modules/listing-policy"
import { snapshotOffer } from "../lib/preorder/pricing"
import { estimateDays } from "../lib/preorder/estimate"
import { readCeedmartMetadata } from "../lib/order-categorization/types"
import { recordAcceptance } from "../lib/terms"
import { TERMS_SLUGS } from "../modules/terms"

// P1 — turn paid pre-order lines into tracked pre-order contracts.
//
// Fires on order.placed. For each line whose listing carries a preorder
// policy, writes a PreorderOrder freezing what was agreed: unit price, FX
// rate, cost breakdown, delivery window, terms version, condition and
// warranty (BRD §6.6 "a paid order records an immutable price,
// exchange-rate snapshot, promised date and terms version").
//
// ── Why snapshot instead of joining ─────────────────────────────────────
// The offer is a template that ops edits — re-priced when FX moves,
// re-timed when a supplier gets slower. §5.3 requires historical
// transaction totals not to move when catalogue prices change. Copying the
// facts at capture is the only way to guarantee that without freezing the
// offer itself.
//
// ── Idempotency ─────────────────────────────────────────────────────────
// order.placed can be redelivered. A unique index on line_item_id means a
// retry cannot create a second contract for the same purchase, and we check
// first so a retry is quiet rather than an error.
//
// The promised date is deliberately NOT set here. §6.2 starts the clock at
// sourcing confirmation, not payment — we cannot promise a window for an
// item nobody has confirmed is buyable yet. Only estimate_days is carried,
// so the date can be projected the moment sourcing is confirmed.

export default async function preorderCaptureHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const preorders: any = container.resolve(PREORDER_MODULE)
    const policies: any = container.resolve(LISTING_POLICY_MODULE)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "metadata",
        "email",
        "customer_id",
        "items.id",
        "items.variant_id",
        "items.product_id",
        "items.quantity",
      ],
      filters: { id: orderId },
    })

    const order = (orders as any[])[0]
    const items = (order?.items ?? []) as any[]
    if (!items.length) return

    const variantIds = items.map((i) => i.variant_id).filter(Boolean)
    const productIds = items.map((i) => i.product_id).filter(Boolean)
    if (!variantIds.length && !productIds.length) return

    const [variantPolicies, productPolicies] = await Promise.all([
      variantIds.length
        ? policies.listListingPolicies({
            variant_id: variantIds,
            commerce_type: "preorder",
          })
        : [],
      productIds.length
        ? policies.listListingPolicies({
            product_id: productIds,
            commerce_type: "preorder",
          })
        : [],
    ])

    const byVariant = new Map<string, any>(
      (variantPolicies as any[]).map((p) => [p.variant_id, p])
    )
    const byProduct = new Map<string, any>(
      (productPolicies as any[]).map((p) => [p.product_id, p])
    )

    // The terms version the customer accepted at checkout, stamped onto the
    // cart by the storefront and carried into order.metadata on complete.
    const termsVersionId = readCeedmartMetadata(order.metadata).terms_version_id

    for (const item of items) {
      const policy =
        byVariant.get(item.variant_id) ?? byProduct.get(item.product_id)
      if (!policy?.reference_id) continue

      const existing = await preorders.listPreorderOrders(
        { line_item_id: item.id },
        { take: 1 }
      )
      if (existing?.length) continue

      const offer = await preorders
        .retrievePreorderOffer(policy.reference_id)
        .catch(() => null)

      if (!offer) {
        // The listing was flagged pre-order but its offer is gone. Better
        // to shout than to let a paid order fall through unnoticed.
        logger.error(
          `[preorder-capture] order ${order.display_id ?? orderId} line ${item.id} ` +
            `references missing offer ${policy.reference_id} — needs manual review`
        )
        continue
      }

      const snapshot = snapshotOffer(offer, item.quantity ?? 1)

      const created = await preorders.createPreorderOrders({
        order_id: orderId,
        order_display_id: order.display_id ?? null,
        line_item_id: item.id,
        offer_id: offer.id,
        variant_id: item.variant_id ?? null,
        ...snapshot,
        estimate_days: estimateDays(offer),
        terms_version_id: termsVersionId ?? null,
        // Payment has landed by the time order.placed fires.
        status: "paid",
      })

      const preorderOrder = Array.isArray(created) ? created[0] : created

      // Seed the history so the customer's tracking view is never empty
      // between payment and the first ops action.
      await preorders.createPreorderMilestones({
        preorder_order_id: preorderOrder.id,
        status: "paid",
        occurred_at: new Date(),
        customer_note:
          "Payment received. We're confirming availability with our US supplier.",
      })

      // §6.6 — durable evidence that these terms were accepted for this
      // order. The cart metadata stamp is what checkout gated on; this row
      // is what survives a dispute.
      if (termsVersionId) {
        await recordAcceptance(container, {
          slug: TERMS_SLUGS.PREORDER,
          entityType: "order",
          entityId: orderId,
          customerId: order.customer_id ?? null,
          contact: order.email ?? null,
        }).catch((err: any) =>
          logger.error(
            `[preorder-capture] could not record terms acceptance for ${orderId}: ${err?.message ?? err}`
          )
        )
      }

      logger.info(
        `[preorder-capture] order ${order.display_id ?? orderId} line ${item.id} ` +
          `captured against offer ${offer.id} (${estimateDays(offer)}-day window)`
      )
    }
  } catch (err: any) {
    logger.error(
      `[preorder-capture] order ${orderId}: ${err?.message ?? err}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "preorder-capture" },
}
