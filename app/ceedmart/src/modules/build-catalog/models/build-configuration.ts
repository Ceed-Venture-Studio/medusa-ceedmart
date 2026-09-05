import { model } from "@medusajs/framework/utils"

// A saved configuration (BRD §7.8).
//
// "Signed-in customers can save draft configurations", they get
// "human-readable reference numbers", and "a saved build can be duplicated
// and modified".
//
// §7.8 also says reordering a historical build creates a NEW request,
// because price and availability move — so a configuration is never
// re-submitted, only copied.

const BuildConfiguration = model
  .define("BuildConfiguration", {
    id: model.id({ prefix: "bcfg" }).primaryKey(),
    reference: model.text().unique(),

    customer_id: model.text().nullable(),
    // Anonymous drafts are keyed by a browser-held token, so a shopper who
    // has not signed in does not lose their work.
    session_token: model.text().nullable(),

    name: model.text().nullable(),
    build_type: model.text().default("desktop"),
    model_family: model.text().nullable(),

    // [{ category_code, option_id, quantity }]
    selections: model.json(),

    // Last computed estimate, kobo. Advisory only — §7.9 says estimates are
    // not binding until a quote is accepted.
    estimated_total: model.bigNumber().nullable(),
    currency_code: model.text().default("ngn"),

    // Warnings the customer acknowledged and chose to override (§7.3).
    // Recorded so a later dispute can show what they were told.
    acknowledged_warnings: model.json().nullable(),

    // Set when the configuration was turned into a build request.
    submitted_request_id: model.text().nullable(),
    // Copied from another configuration (§7.8 duplication).
    copied_from_id: model.text().nullable(),
  })
  .indexes([
    { on: ["reference"], unique: true },
    { on: ["customer_id"] },
    { on: ["session_token"] },
    { on: ["created_at"] },
  ])

export default BuildConfiguration
