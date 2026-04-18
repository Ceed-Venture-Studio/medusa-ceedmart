import { model } from "@medusajs/framework/utils"

const SearchLog = model
  .define("SearchLog", {
    id: model.id({ prefix: "srchl" }).primaryKey(),
    query: model.text().searchable(),
    result_count: model.number().default(0),
    result_ids: model.json().nullable(),
    customer_id: model.text().nullable(),
    session_id: model.text().nullable(),
    sales_channel_id: model.text().nullable(),
    region_id: model.text().nullable(),
    currency_code: model.text().nullable(),
    filters: model.json().nullable(),
    locale: model.text().nullable(),
    user_agent: model.text().nullable(),
  })
  .indexes([
    { on: ["customer_id"] },
    { on: ["session_id"] },
    { on: ["sales_channel_id"] },
    { on: ["created_at"] },
  ])

export default SearchLog
