import { model } from "@medusajs/framework/utils"

// One line of the quality-assurance checklist for a build (BRD §7.9, §7.10).
//
// §7.9: "staff must record quality-assurance results before marking a build
// ready for dispatch." §7.10 makes it an acceptance criterion.
//
// Rows are created from a template when a build enters assembly, so the
// checklist is the same every time and cannot be quietly shortened for a
// build that is running late. `is_required` separates the checks that gate
// dispatch from the ones that are merely recorded.

const QaCheck = model
  .define({ name: "QaCheck", tableName: "build_qa_check" }, {
    id: model.id({ prefix: "bldqa" }).primaryKey(),
    build_order_id: model.text(),

    code: model.text(),
    label: model.text(),
    is_required: model.boolean().default(true),
    sort_order: model.number().default(0),

    // "pending" | "passed" | "failed" | "not_applicable"
    result: model.text().default("pending"),
    // Required when a check fails, so "it failed" is never the whole record.
    notes: model.text().nullable(),
    checked_by: model.text().nullable(),
    checked_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["build_order_id"] },
    { on: ["build_order_id", "code"], unique: true },
    { on: ["result"] },
  ])

export default QaCheck
