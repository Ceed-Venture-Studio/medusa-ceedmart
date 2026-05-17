import { model } from "@medusajs/framework/utils"

const Banner = model
  .define("Banner", {
    id: model.id({ prefix: "bnr" }).primaryKey(),
    name: model.text(),                      // admin label
    slot: model.text(),                      // BannerSlot.key
    image_url: model.text(),                 // public URL (in bucket)
    image_key: model.text().nullable(),      // bucket key for delete
    image_width: model.number(),
    image_height: model.number(),
    image_mime_type: model.text(),
    link_url: model.text().nullable(),       // optional CTA
    alt_text: model.text().nullable(),
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    priority: model.number().default(0),     // higher = shown first
    status: model.text().default("draft"),   // draft|active|archived
    sales_channel_id: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["slot"] },
    { on: ["status"] },
    { on: ["sales_channel_id"] },
    { on: ["created_at"] },
  ])

export default Banner
