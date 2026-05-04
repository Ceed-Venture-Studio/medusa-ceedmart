import { model } from "@medusajs/framework/utils"

const SolarCalculation = model
  .define("SolarCalculation", {
    id: model.id({ prefix: "solcalc" }).primaryKey(),
    appliances: model.json(),
    total_load_w: model.number(),
    daily_kwh: model.number(),
    night_kwh: model.number(),
    has_heavy_motors: model.boolean().default(false),
    margin_pct: model.number(),
    recommendations: model.json().nullable(),
    session_id: model.text().nullable(),
    sales_channel_id: model.text().nullable(),
    locale: model.text().nullable(),
    user_agent: model.text().nullable(),
  })
  .indexes([
    { on: ["session_id"] },
    { on: ["created_at"] },
  ])

export default SolarCalculation
