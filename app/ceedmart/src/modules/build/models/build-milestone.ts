import { model } from "@medusajs/framework/utils"

// Append-only progress history for a build (BRD §7.2 step 9: the customer
// tracks procurement, assembly, quality assurance, dispatch and delivery).
//
// Same split as preorder_milestone: audit answers "who changed what", this
// answers "where is my machine". Customer-visible and internal notes are
// separate fields per §5.5.

const BuildMilestone = model
  .define("BuildMilestone", {
    id: model.id({ prefix: "bldm" }).primaryKey(),
    build_order_id: model.text(),
    status: model.text(),
    occurred_at: model.dateTime(),
    expected_next_at: model.dateTime().nullable(),
    customer_note: model.text().nullable(),
    internal_note: model.text().nullable(),
    delay_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["build_order_id"] },
    { on: ["status"] },
    { on: ["occurred_at"] },
  ])

export default BuildMilestone
