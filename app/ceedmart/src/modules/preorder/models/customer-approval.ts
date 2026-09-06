import { model } from "@medusajs/framework/utils"

// An explicit customer decision on a change to their pre-order
// (BRD §6.4, §6.5).
//
// Two rules this table exists to enforce:
//
//   • "If a post-payment price increase is permitted, CeedMart must request
//      customer approval; SILENCE CANNOT BE TREATED AS APPROVAL."
//   • "CeedMart must not silently substitute a brand, model, colour,
//      condition, capacity, keyboard layout, plug type, or other material
//      attribute. Any material substitution requires explicit customer
//      approval."
//
// So a request starts as `pending` and only a recorded customer action
// moves it. An expiry does NOT approve it — it escalates to ops, because
// the alternative is treating a customer who never replied as having agreed
// to pay more.

const CustomerApproval = model
  .define({ name: "CustomerApproval", tableName: "preorder_customer_approval" }, {
    id: model.id({ prefix: "preap" }).primaryKey(),
    preorder_order_id: model.text(),
    order_id: model.text().nullable(),

    // "price_increase" | "substitution" | "address_correction" | "delay"
    kind: model.text(),
    // Plain-language description of exactly what is changing.
    description: model.text(),
    // For price changes: old and new unit price in kobo.
    previous_value: model.json().nullable(),
    proposed_value: model.json().nullable(),

    // "pending" | "approved" | "rejected" | "expired"
    status: model.text().default("pending"),
    requested_at: model.dateTime(),
    // After this we stop waiting and escalate — we never auto-approve.
    expires_at: model.dateTime().nullable(),
    responded_at: model.dateTime().nullable(),
    // Opaque token so the customer can respond from an email link without
    // signing in.
    response_token: model.text().nullable(),
    responded_by: model.text().nullable(),
    customer_note: model.text().nullable(),
  })
  .indexes([
    { on: ["preorder_order_id"] },
    { on: ["status"] },
    { on: ["response_token"], unique: true },
    { on: ["expires_at"] },
  ])

export default CustomerApproval
