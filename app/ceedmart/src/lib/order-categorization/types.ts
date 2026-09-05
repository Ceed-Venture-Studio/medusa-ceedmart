// Standardized Ceedmart order metadata. Written under `order.metadata.ceedmart`
// by the storefront (cart complete) and the POS (order capture), and read by
// the admin order-detail badge widget, the partner-commission subscribers and
// ops reporting.
//
// ── Why this file exists ────────────────────────────────────────────────
// `metadata.ceedmart` is a SHARED bag with several independent writers:
//
//   • categorization  — channel / store_id / fulfillment / sourcing (H3)
//   • attribution     — partner_code (M3)
//   • commerce        — commerce_type, terms_version (Phase 3)
//
// Each writer only knows about its own slice. A writer that composes a fresh
// `ceedmart` object and assigns it wholesale silently deletes every other
// writer's keys. That is exactly what happened between the storefront's
// referral stamp and its fulfillment-mode picker: the later write dropped
// `partner_code`, and partner commission then accrued nothing for those
// orders.
//
// So: NEVER assign `metadata.ceedmart` directly. Always go through
// `mergeCeedmartMetadata` below, which reads the existing block and patches
// only the keys you pass. The storefront and POS carry their own copies of
// this helper (they are separate repositories) — keep the three in step.
//
// Missing values are treated as unknown, never as a default, so we can
// distinguish "cashier didn't pick" from "cashier picked delivery" during
// rollout and analytics.

export type OrderChannel = "online" | "in-store"
export type OrderFulfillment = "pickup" | "delivery"
export type OrderSourcing = "local" | "cross-warehouse"

/** Phase 3 — every sellable listing has exactly one primary commerce type
 *  (BRD §5.1). Resolved from the listing policy at cart time and frozen onto
 *  the order, so a listing later changing type never rewrites history. */
export type CommerceType = "standard" | "preorder" | "custom_build" | "auction"

export type CeedmartOrderMetadata = {
  // ── Categorization (H3) ──────────────────────────────────────────
  channel?: OrderChannel
  // sales_channel_id of the physical shop. Set for in-store orders (POS)
  // and for online orders where the customer chose pickup at a specific
  // shop. Undefined for online delivery orders that ship from the
  // warehouse without a shop touchpoint.
  store_id?: string
  fulfillment?: OrderFulfillment
  // "local" — every item was in stock at the sourcing location.
  // "cross-warehouse" — one or more items had to be pulled from a
  // fallback warehouse.
  sourcing?: OrderSourcing

  // ── Attribution (M3) ─────────────────────────────────────────────
  /** Partner referral code, frozen at first stamp. Read by
   *  subscribers/partner-commission-accrue.ts. */
  partner_code?: string

  // ── Commerce type (Phase 3) ──────────────────────────────────────
  /** Absent is read as "standard" by consumers, so existing orders need no
   *  backfill. */
  commerce_type?: CommerceType
  /** Version of the customer-facing terms accepted at checkout (BRD §5.3).
   *  Points at a TermsVersion id. */
  terms_version_id?: string
}

/** Patch shape for ceedmartOrderMetadata merges: every field optional, and
 *  explicitly nullable so a caller can clear a key it previously set. */
export type CeedmartMetadataPatch = {
  [K in keyof CeedmartOrderMetadata]?: CeedmartOrderMetadata[K] | null
}

export const CEEDMART_METADATA_KEY = "ceedmart"

/**
 * Merge a partial Ceedmart block into an existing metadata object.
 *
 * Preserves both unrelated top-level metadata keys AND the keys other
 * writers have already set inside `ceedmart`. This is the only supported way
 * to write the block.
 *
 * Passing `undefined` for a field leaves any existing value alone; pass
 * `null` to clear one explicitly.
 */
export const mergeCeedmartMetadata = (
  existing: Record<string, unknown> | null | undefined,
  patch: CeedmartMetadataPatch
): Record<string, unknown> => {
  const base = existing ?? {}
  const current = (base[CEEDMART_METADATA_KEY] ?? {}) as Record<string, unknown>

  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) {
      delete next[key]
      continue
    }
    next[key] = value
  }

  return { ...base, [CEEDMART_METADATA_KEY]: next }
}

/** Read the Ceedmart block off any entity carrying metadata. */
export const readCeedmartMetadata = (
  existing: Record<string, unknown> | null | undefined
): CeedmartOrderMetadata => {
  return ((existing ?? {})[CEEDMART_METADATA_KEY] ?? {}) as CeedmartOrderMetadata
}

/** Commerce type with the "absent means standard" default applied. */
export const resolveCommerceType = (
  existing: Record<string, unknown> | null | undefined
): CommerceType => {
  return readCeedmartMetadata(existing).commerce_type ?? "standard"
}

/**
 * @deprecated Replaces the whole `ceedmart` block and will drop keys written
 * by other parts of the system. Use `mergeCeedmartMetadata` instead. Kept so
 * existing callers keep compiling; remove once none remain.
 */
export const withCeedmartMetadata = (
  existing: Record<string, unknown> | null | undefined,
  ceedmart: CeedmartOrderMetadata
): Record<string, unknown> => {
  return mergeCeedmartMetadata(existing, ceedmart)
}
