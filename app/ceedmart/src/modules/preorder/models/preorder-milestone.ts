import { model } from "@medusajs/framework/utils"

// Append-only milestone history for a pre-order (BRD §6.4 "staff can record
// carrier, tracking reference, estimated milestone dates, evidence/notes,
// and delay reasons").
//
// Distinct from the audit trail: audit answers "who changed what", this
// answers "where is my item and when will it move next". The customer sees
// a simplified version of these rows; staff see all of them.

const PreorderMilestone = model
  .define("PreorderMilestone", {
    id: model.id({ prefix: "prem" }).primaryKey(),
    preorder_order_id: model.text(),

    // The status this milestone records reaching.
    status: model.text(),
    occurred_at: model.dateTime(),
    // When we expect the NEXT movement, if known.
    expected_next_at: model.dateTime().nullable(),

    carrier: model.text().nullable(),
    tracking_reference: model.text().nullable(),
    tracking_url: model.text().nullable(),

    // Shown to the customer on the tracking page. Kept separate from
    // internal notes per §5.5 (internal-only vs customer-visible notes).
    customer_note: model.text().nullable(),
    internal_note: model.text().nullable(),
    // Why the item sat still, when it did.
    delay_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["preorder_order_id"] },
    { on: ["status"] },
    { on: ["occurred_at"] },
  ])

export default PreorderMilestone
