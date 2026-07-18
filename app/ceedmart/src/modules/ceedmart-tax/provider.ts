import type {
  ITaxProvider,
  Logger,
  MedusaContainer,
  TaxTypes,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ModuleProvider,
  Modules,
} from "@medusajs/framework/utils"
import CeedmartTaxModuleService from "./service"
import { CEEDMART_TAX_MODULE } from "./index"

type InjectedDeps = {
  logger: Logger
  __container__: MedusaContainer
}

// Custom Medusa tax provider that reads tax rates from the ceedmart_tax
// module's TaxOverride table. Priority (highest first):
//   1. Shop rule matching cart.sales_channel_id
//   2. Collection rule matching item.product.collection_id
//   3. General rule
//
// Every rate returned uses a stable synthetic id `ceedmart-<overrideId>` so
// downstream code can match rates without conflicting with Medusa's own
// tax_rate table.
//
// Shipping lines are taxed at the general rate; shipping doesn't have a
// product or a natural shop scope in the tax calculation context.

export class CeedmartTaxProvider implements ITaxProvider {
  static identifier = "ceedmart"

  #logger: Logger
  #container: MedusaContainer

  constructor(deps: InjectedDeps) {
    this.#logger = deps.logger
    this.#container = deps.__container__
  }

  getIdentifier(): string {
    return CeedmartTaxProvider.identifier
  }

  async getTaxLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    _context: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    const overrideService = this.#container.resolve<CeedmartTaxModuleService>(
      CEEDMART_TAX_MODULE
    )
    const query = this.#container.resolve(ContainerRegistrationKeys.QUERY)

    // Load all active rules once per calculation — small table, no need to
    // paginate. Sorted at usage time by scope precedence.
    const rules = (await overrideService.listTaxOverrides(
      { is_active: true },
      { take: 1000 }
    )) as any[]

    const general = rules.find((r) => r.scope === "general") ?? null
    const collectionRules = new Map<string, any>()
    const shopRules = new Map<string, any>()
    for (const r of rules) {
      if (r.scope === "collection" && r.reference_id) {
        collectionRules.set(r.reference_id, r)
      } else if (r.scope === "shop" && r.reference_id) {
        shopRules.set(r.reference_id, r)
      }
    }

    // Resolve sales_channel_id for each line_item. Line items may live on
    // either a cart (checkout) or an order (post-conversion). Query both;
    // whichever returns is the source of truth for this calculation.
    const lineItemIds = Array.from(
      new Set(itemLines.map((l) => l.line_item.id).filter(Boolean))
    )
    const salesChannelByLineItem = new Map<string, string>()
    if (lineItemIds.length) {
      try {
        const { data: cartItems } = await query.graph({
          entity: "cart_line_item",
          fields: ["id", "cart.sales_channel_id"],
          filters: { id: lineItemIds },
        })
        for (const row of cartItems as any[]) {
          const scid = row.cart?.sales_channel_id
          if (scid) salesChannelByLineItem.set(row.id, scid)
        }
      } catch (e) {
        // Cart entity may not resolve if these are order items.
      }
      const missing = lineItemIds.filter(
        (id) => !salesChannelByLineItem.has(id)
      )
      if (missing.length) {
        try {
          const { data: orderItems } = await query.graph({
            entity: "order_line_item",
            fields: ["id"],
            filters: { id: missing },
          })
          const orderItemIds = (orderItems as any[]).map((r) => r.id)
          if (orderItemIds.length) {
            // order.sales_channel_id via the order_item join.
            const { data: joins } = await query.graph({
              entity: "order_item",
              fields: ["item_id", "order.sales_channel_id"],
              filters: { item_id: orderItemIds },
            })
            for (const row of joins as any[]) {
              const scid = row.order?.sales_channel_id
              if (scid && row.item_id) {
                salesChannelByLineItem.set(row.item_id, scid)
              }
            }
          }
        } catch (e) {
          // Order lookup best-effort; falls through to no shop rule.
        }
      }
    }

    // Resolve product → collection_id in one shot.
    const productIds = Array.from(
      new Set(itemLines.map((l) => l.line_item.product_id).filter(Boolean))
    )
    const collectionByProduct = new Map<string, string | null>()
    if (productIds.length) {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "collection_id"],
        filters: { id: productIds },
      })
      for (const p of products as any[]) {
        collectionByProduct.set(p.id, p.collection_id ?? null)
      }
    }

    const asTaxLine = (
      lineItemId: string,
      rule: any
    ): TaxTypes.ItemTaxLineDTO => ({
      rate_id: `ceedmart-${rule.id}`,
      rate: Number(rule.rate) || 0,
      name: rule.name,
      code: `CDMT_${String(rule.scope).toUpperCase()}`,
      line_item_id: lineItemId,
      provider_id: this.getIdentifier(),
    })

    const itemTaxLines: TaxTypes.ItemTaxLineDTO[] = []
    for (const line of itemLines) {
      const scid = salesChannelByLineItem.get(line.line_item.id) ?? null
      const shopRule = scid ? shopRules.get(scid) ?? null : null
      const colId = collectionByProduct.get(line.line_item.product_id) ?? null
      const collectionRule = colId ? collectionRules.get(colId) ?? null : null
      const rule = shopRule ?? collectionRule ?? general
      if (!rule) continue
      itemTaxLines.push(asTaxLine(line.line_item.id, rule))
    }

    // Shipping: apply general rate only.
    const shippingTaxLines: TaxTypes.ShippingTaxLineDTO[] = []
    if (general) {
      for (const line of shippingLines) {
        shippingTaxLines.push({
          rate_id: `ceedmart-${general.id}`,
          rate: Number(general.rate) || 0,
          name: general.name,
          code: `CDMT_GENERAL_SHIPPING`,
          shipping_line_id: line.shipping_line.id,
          provider_id: this.getIdentifier(),
        })
      }
    }

    return [...itemTaxLines, ...shippingTaxLines]
  }
}

export default ModuleProvider(Modules.TAX, {
  services: [CeedmartTaxProvider],
})
