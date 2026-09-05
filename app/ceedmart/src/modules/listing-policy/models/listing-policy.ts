import { model } from "@medusajs/framework/utils"

// Commerce type and per-type configuration for a sellable listing
// (BRD §5.1: "every sellable listing must have exactly one primary commerce
// type").
//
// ── Why a module and not product metadata ───────────────────────────────
// Product metadata is untyped, unindexed, has no migration path, and has
// already proven lossy in this codebase — see the P0-1 fix for what happens
// when several writers share one untyped bag. Commerce type decides whether
// an item can be added to a cart at all, so it needs to be queryable and
// constrained.
//
// A policy attaches to either a product (applies to all its variants) or a
// single variant. Variant beats product when both exist, so a product can be
// standard stock while one exotic variant is a US pre-order.
//
// Listings with no policy row are "standard" — so nothing needs backfilling
// and the default stays the safe one.

const ListingPolicy = model
  .define("ListingPolicy", {
    id: model.id({ prefix: "lpol" }).primaryKey(),

    // Exactly one of these is set. Enforced by the check constraint in the
    // migration rather than by convention.
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),

    // "standard" | "preorder" | "custom_build" | "auction"
    commerce_type: model.text().default("standard"),

    // Whether the listing is currently sellable under this type. An expired
    // pre-order offer or an ended auction flips this off without deleting
    // the policy, so history stays readable.
    is_active: model.boolean().default(true),

    // Per-type configuration. Deliberately loose: each feature module owns
    // its own detailed tables (PreorderOffer, Auction), and this holds only
    // what the catalogue and cart need to make a decision without joining
    // to them — badge copy, lead-time text, the offer/auction id to follow.
    config: model.json().nullable(),

    // Denormalised pointer to the owning feature record, so the cart can
    // reject an item without knowing which module to ask.
    reference_id: model.text().nullable(),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["variant_id"] },
    { on: ["commerce_type"] },
    { on: ["is_active"] },
  ])

export default ListingPolicy
