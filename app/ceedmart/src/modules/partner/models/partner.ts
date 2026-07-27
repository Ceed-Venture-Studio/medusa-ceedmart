import { model } from "@medusajs/framework/utils"

// Partner Member (spec §6). External individuals/businesses that drive
// verified sales via a unique referral code carried on the order metadata.
// Ambassador tier (§9.15) is intentionally not modelled — the spec forbids
// activating financial rules for it.

const Partner = model
  .define("Partner", {
    id: model.id({ prefix: "ptn" }).primaryKey(),

    // Human-readable identity.
    name: model.text(),
    email: model.text().nullable(),
    phone: model.text().nullable(),
    company: model.text().nullable(),

    // Unique attribution code — carried on the order as
    // metadata.ceedmart.partner_code.
    code: model.text().unique(),

    // Program tier from the Ceedmart incentive spec. Drives the default
    // commission_rate — see lib/partner-commissions/tiers.ts.
    // Values: SHOPPER (default), EMPLOYEE_SALES, RESELLER, PARTNER.
    tier: model.text().default("SHOPPER"),

    // Rate derived from tier at create/update time. Stored so it's
    // frozen onto each commission_entry at accrual time and future
    // spec/tier-rate changes never rewrite history.
    commission_rate: model.number().default(0.02),

    // Status lifecycle. MVP does NOT automate 3-strike inactivation
    // (spec §9.8) — admins flip this manually until the automation lands.
    // Only "active" partners generate new commission entries.
    status: model.text().default("active"),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["code"] },
    { on: ["status"] },
    { on: ["created_at"] },
  ])

export default Partner
