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
    link_url: model.text().nullable(),       // primary CTA URL
    cta_1_label: model.text().nullable(),    // primary CTA label (paired with link_url)
    cta_2_url: model.text().nullable(),      // secondary CTA URL
    cta_2_label: model.text().nullable(),    // secondary CTA label
    headline: model.text().nullable(),       // main promo text (carousel slot)
    subheadline: model.text().nullable(),    // supporting text (carousel slot)
    primary_color: model.text().nullable(),  // background color (hex, e.g. "#05007F")
    secondary_color: model.text().nullable(),// text color (hex)
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
