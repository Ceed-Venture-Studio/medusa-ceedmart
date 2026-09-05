import { model } from "@medusajs/framework/utils"

// The quote attached to a build request (BRD §7.6).
//
// This row is the CONTAINER — stable identity, current state, which version
// is live. The priced content lives in BuildQuoteVersion, because §7.6
// requires that "quotes are versioned; changes create a new version without
// overwriting prior versions" and that "only the latest valid quote can be
// accepted".
//
// Splitting them is what makes both rules structural rather than
// disciplinary: there is no field here anyone could edit to rewrite what a
// customer was quoted last week.

const BuildQuote = model
  .define("BuildQuote", {
    id: model.id({ prefix: "bldq" }).primaryKey(),
    request_id: model.text(),
    reference: model.text().unique(),

    // The version customers may currently act on. Superseded versions stay
    // readable but cannot be accepted.
    current_version_id: model.text().nullable(),
    version_count: model.number().default(0),

    // "draft" | "sent" | "accepted" | "rejected" | "expired" | "superseded"
    status: model.text().default("draft"),

    accepted_version_id: model.text().nullable(),
    accepted_at: model.dateTime().nullable(),
    // Identity captured at acceptance (§7.6 "acceptance records customer
    // identity, timestamp, quote version, configuration snapshot, price,
    // and terms version").
    accepted_by: model.text().nullable(),
    terms_version_id: model.text().nullable(),

    rejected_at: model.dateTime().nullable(),
    rejection_reason: model.text().nullable(),

    // The order created when the quote was accepted and paid for.
    order_id: model.text().nullable(),
  })
  .indexes([
    { on: ["request_id"] },
    { on: ["reference"], unique: true },
    { on: ["status"] },
    { on: ["order_id"] },
  ])

export default BuildQuote
