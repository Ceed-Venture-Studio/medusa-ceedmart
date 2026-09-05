import { model } from "@medusajs/framework/utils"

// An accepted, payable custom build (BRD §7.7).
//
// Created when a quote is accepted. Like PreorderOrder, everything
// commercial is SNAPSHOTTED — §7.6 requires acceptance to record the
// configuration snapshot, price and terms version, and §7.9 that component
// availability be rechecked at quote time and at acceptance. The quote
// version stays readable, but this row is what the build is actually
// against.

const BuildOrder = model
  .define("BuildOrder", {
    id: model.id({ prefix: "bldo" }).primaryKey(),
    request_id: model.text(),
    quote_id: model.text(),
    quote_version_id: model.text(),
    reference: model.text().unique(),

    order_id: model.text().nullable(),
    order_display_id: model.number().nullable(),
    customer_id: model.text().nullable(),

    // Frozen copy of the accepted version's content and totals.
    configuration_snapshot: model.json(),
    total: model.bigNumber(),
    currency_code: model.text().default("ngn"),
    terms_version_id: model.text().nullable(),

    // Values come from buildOrderMachine in lib/state-machine/machines.
    status: model.text().default("quote_accepted"),
    build_days: model.number().nullable(),
    promised_ready_date: model.dateTime().nullable(),

    assigned_to: model.text().nullable(),
    // §7.10 — staff cannot mark a build ready for dispatch without
    // completing the QA checklist. Set only when every required item has
    // passed, and read as the gate by the transition route.
    qa_passed_at: model.dateTime().nullable(),
    qa_passed_by: model.text().nullable(),

    exception_reason: model.text().nullable(),
    exception_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["reference"], unique: true },
    { on: ["request_id"] },
    { on: ["quote_id"] },
    { on: ["order_id"] },
    { on: ["status"] },
    { on: ["assigned_to"] },
  ])

export default BuildOrder
