import { model } from "@medusajs/framework/utils"

// One immutable revision of a terms document.
//
// Versions are append-only: correcting wording means publishing a new
// version, never editing a published one. An order accepted against v3 must
// still render v3 in a dispute two years later.

const TermsVersion = model
  .define("TermsVersion", {
    id: model.id({ prefix: "termsv" }).primaryKey(),
    document_id: model.text(),
    // Monotonic per document, starting at 1.
    version: model.number(),
    // Rendered HTML shown at checkout and stored for the record.
    body: model.text(),
    // Short customer-facing summary of what changed — surfaced when we have
    // to tell a bidder the terms were materially edited (§8.10).
    change_note: model.text().nullable(),
    // Null until published; a draft is editable, a published version is not.
    published_at: model.dateTime().nullable(),
    // The version new transactions accept. Exactly one per document should
    // carry this; publishing a newer version clears it on the older one.
    is_current: model.boolean().default(false),
  })
  .indexes([
    { on: ["document_id"] },
    { on: ["document_id", "version"], unique: true },
    { on: ["is_current"] },
  ])

export default TermsVersion
