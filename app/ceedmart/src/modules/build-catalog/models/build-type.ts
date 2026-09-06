import { model } from "@medusajs/framework/utils"

// A kind of thing that can be configured (BRD §7.1).
//
// §7.1 asks for "an architecture that can later support other configurable
// products". Desktop and laptop shipped first as a CHECK-constrained enum
// on the category, which meant a third kind — a server, a CCTV kit, a solar
// system — needed a migration and a deploy.
//
// Making it a row instead means adding one is an admin action. Nothing in
// the engine knows what a "desktop" is; it only knows that a build type has
// slots, and slots have options and rules.

const BuildType = model
  .define("BuildType", {
    id: model.id({ prefix: "btype" }).primaryKey(),
    code: model.text().unique(),
    label: model.text(),
    description: model.text().nullable(),
    // Copy for the storefront picker when more than one type is live.
    customer_blurb: model.text().nullable(),
    is_active: model.boolean().default(true),
    sort_order: model.number().default(0),
  })
  .indexes([{ on: ["code"], unique: true }, { on: ["is_active"] }])

export default BuildType
