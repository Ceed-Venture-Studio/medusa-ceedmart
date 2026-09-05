import { model } from "@medusajs/framework/utils"

// A record that a specific customer accepted a specific terms version for a
// specific transaction (BRD §6.6 "the customer must accept the applicable
// pre-order terms before payment", §7.6, §8.4).
//
// Append-only. The captured IP and user agent are the evidence that the
// acceptance happened, which is the whole point of the row in a dispute.

const TermsAcceptance = model
  .define("TermsAcceptance", {
    id: model.id({ prefix: "termsa" }).primaryKey(),
    version_id: model.text(),
    document_slug: model.text(),

    // Who accepted. Guest checkouts have no customer_id, so the contact
    // used at checkout is stored alongside.
    customer_id: model.text().nullable(),
    contact: model.text().nullable(),

    // What it was accepted for: "order", "build_quote", "auction_bid".
    // Not a foreign key — the acceptance must outlive the subject.
    entity_type: model.text(),
    entity_id: model.text(),

    // Evidence.
    accepted_at: model.dateTime(),
    ip_address: model.text().nullable(),
    user_agent: model.text().nullable(),
  })
  .indexes([
    { on: ["entity_type", "entity_id"] },
    { on: ["customer_id"] },
    { on: ["version_id"] },
    { on: ["accepted_at"] },
  ])

export default TermsAcceptance
