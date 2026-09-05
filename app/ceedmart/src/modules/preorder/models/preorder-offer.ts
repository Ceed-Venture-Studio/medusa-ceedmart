import { model } from "@medusajs/framework/utils"

// A product or variant offered as a US pre-order (BRD §6.4).
//
// ── Pricing (D-02: locked all-inclusive naira price) ────────────────────
// `locked_price` is what the customer pays, in kobo, and it already
// includes duty, clearing and local delivery. The customer is never asked
// to top up later. `cost_components` records how that number was reached —
// source price, FX rate, freight, duty, margin — so finance can see the
// margin on every pre-order without that breakdown ever reaching the
// storefront.
//
// The breakdown is advisory. `locked_price` is authoritative: if someone
// edits a component later, what the customer was quoted does not move.
//
// ── Delivery estimate (D-01) ────────────────────────────────────────────
// Deliberately NOT a hardcoded fourteen days. The window is three settable
// legs — procurement, international transit, customs — so ops can tune each
// per offer as real data arrives, and a supplier that reliably ships in two
// days stops being averaged with one that takes ten. The sum is what the
// customer sees.

const PreorderOffer = model
  .define("PreorderOffer", {
    id: model.id({ prefix: "pre" }).primaryKey(),

    // Exactly one target, mirroring listing_policy precedence.
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    supplier_id: model.text().nullable(),
    source_country_code: model.text().default("us"),

    // ── Price (kobo, all-inclusive) ───────────────────────────────
    locked_price: model.bigNumber(),
    currency_code: model.text().default("ngn"),
    // { source_price_usd, fx_rate, freight, insurance, duty, clearing,
    //   local_delivery, margin, contingency } — internal only.
    cost_components: model.json().nullable(),
    // Rate used when the price was set, kept so a later FX move is visibly
    // a re-pricing decision rather than a silent drift.
    fx_rate: model.number().nullable(),
    fx_captured_at: model.dateTime().nullable(),

    // What the price covers, shown verbatim at checkout (§6.4 "clearly
    // states whether import duty, clearing, local delivery ... included").
    includes_duty: model.boolean().default(true),
    includes_clearing: model.boolean().default(true),
    includes_local_delivery: model.boolean().default(true),

    // ── Delivery estimate legs (calendar days) ────────────────────
    procurement_days: model.number().default(3),
    transit_days: model.number().default(7),
    customs_days: model.number().default(4),
    // Optional per-offer override of the summed window, for a supplier
    // whose real behaviour does not decompose neatly.
    total_days_override: model.number().nullable(),

    // Nigerian states this offer delivers to. Empty means nationwide.
    delivery_states: model.json().nullable(),

    // ── Item facts the customer must see before committing ────────
    // "new" | "open_box" | "refurbished" | "used"
    condition: model.text().default("new"),
    condition_notes: model.text().nullable(),
    warranty_text: model.text().nullable(),
    // Who honours the warranty: "ceedmart" | "manufacturer" | "third_party"
    warranty_provider: model.text().nullable(),
    return_policy_text: model.text().nullable(),

    // ── Availability ──────────────────────────────────────────────
    // When someone last confirmed the item is actually buyable in the US.
    // Stale verification is the main reason a pre-order fails after payment.
    availability_verified_at: model.dateTime().nullable(),
    // After this the offer stops being addable to a cart (§6.4 "cannot add
    // an unavailable or expired pre-order offer to the cart").
    offer_expires_at: model.dateTime().nullable(),

    // Quantity limits (§6.5).
    max_per_order: model.number().nullable(),
    max_per_customer: model.number().nullable(),

    is_active: model.boolean().default(false),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["variant_id"] },
    { on: ["supplier_id"] },
    { on: ["is_active"] },
    { on: ["offer_expires_at"] },
  ])

export default PreorderOffer
