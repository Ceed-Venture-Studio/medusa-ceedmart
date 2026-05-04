import { model } from "@medusajs/framework/utils"

const SolarQuote = model
  .define("SolarQuote", {
    id: model.id({ prefix: "solq" }).primaryKey(),
    calculation_id: model.text().nullable(),
    selected_tier: model.text(),
    selected_bundle: model.json(),
    customer_name: model.text(),
    customer_email: model.text(),
    customer_phone: model.text().nullable(),
    customer_location: model.text().nullable(),
    notes: model.text().nullable(),
    status: model.text().default("new"),
    email_sent_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["status"] },
    { on: ["customer_email"] },
    { on: ["created_at"] },
  ])

export default SolarQuote
