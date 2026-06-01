import { model } from "@medusajs/framework/utils"

const Requisition = model
  .define("Requisition", {
    id: model.id({ prefix: "req" }).primaryKey(),
    title: model.text().searchable(),
    description: model.text(),            // HTML — rendered on careers page
    apply_url: model.text(),              // required external link
    salary: model.text().nullable(),      // free-form, e.g. "₦400k – ₦600k"
    status: model.text().default("open"), // open | closed
  })
  .indexes([
    { on: ["status"] },
    { on: ["created_at"] },
  ])

export default Requisition
