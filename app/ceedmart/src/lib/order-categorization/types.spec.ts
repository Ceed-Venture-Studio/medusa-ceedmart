import {
  CEEDMART_METADATA_KEY,
  mergeCeedmartMetadata,
  readCeedmartMetadata,
  resolveCommerceType,
} from "./types"

// Regression cover for the metadata clobber (P0-1).
//
// The bug: the storefront stamped `partner_code` on cart resolve, then the
// fulfillment-mode picker rebuilt the whole `ceedmart` block at checkout and
// assigned it wholesale — deleting the code and silently zeroing partner
// commission. These tests pin the merge semantics that prevent a repeat.

describe("mergeCeedmartMetadata", () => {
  it("preserves keys written by other writers inside the ceedmart block", () => {
    const afterReferralStamp = mergeCeedmartMetadata(null, {
      partner_code: "VIC4821",
    })

    const afterFulfillmentPick = mergeCeedmartMetadata(afterReferralStamp, {
      channel: "online",
      fulfillment: "pickup",
      sourcing: "local",
      store_id: "sc_ph_01",
    })

    const block = readCeedmartMetadata(afterFulfillmentPick)
    expect(block.partner_code).toBe("VIC4821")
    expect(block.fulfillment).toBe("pickup")
    expect(block.store_id).toBe("sc_ph_01")
  })

  it("preserves unrelated top-level metadata keys", () => {
    const existing = { cash_paid: 5000, ceedmart: { partner_code: "ABC1" } }

    const next = mergeCeedmartMetadata(existing, { channel: "in-store" })

    expect(next.cash_paid).toBe(5000)
    expect(readCeedmartMetadata(next).partner_code).toBe("ABC1")
  })

  it("leaves a field untouched when the patch passes undefined", () => {
    const existing = mergeCeedmartMetadata(null, { store_id: "sc_ph_01" })

    const next = mergeCeedmartMetadata(existing, {
      fulfillment: "delivery",
      store_id: undefined,
    })

    expect(readCeedmartMetadata(next).store_id).toBe("sc_ph_01")
  })

  it("clears a field when the patch passes null", () => {
    const existing = mergeCeedmartMetadata(null, {
      store_id: "sc_ph_01",
      fulfillment: "pickup",
    })

    const next = mergeCeedmartMetadata(existing, {
      fulfillment: "delivery",
      store_id: null,
    })

    const block = readCeedmartMetadata(next)
    expect(block.store_id).toBeUndefined()
    expect(block.fulfillment).toBe("delivery")
  })

  it("does not mutate the object it was given", () => {
    const existing = { ceedmart: { partner_code: "ABC1" } }

    mergeCeedmartMetadata(existing, { channel: "online" })

    expect(existing[CEEDMART_METADATA_KEY]).toEqual({ partner_code: "ABC1" })
  })

  it("starts from an empty block when metadata is absent", () => {
    const next = mergeCeedmartMetadata(undefined, { channel: "online" })

    expect(readCeedmartMetadata(next)).toEqual({ channel: "online" })
  })
})

describe("resolveCommerceType", () => {
  it("reads an explicit commerce type", () => {
    const meta = mergeCeedmartMetadata(null, { commerce_type: "preorder" })

    expect(resolveCommerceType(meta)).toBe("preorder")
  })

  it("defaults to standard so existing orders need no backfill", () => {
    expect(resolveCommerceType(null)).toBe("standard")
    expect(resolveCommerceType({ ceedmart: { channel: "online" } })).toBe(
      "standard"
    )
  })
})
