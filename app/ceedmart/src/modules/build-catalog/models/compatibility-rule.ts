import { model } from "@medusajs/framework/utils"

// A rule relating two component slots (BRD §7.3).
//
// The BRD lists the rules it wants covered: CPU socket vs motherboard
// socket, memory type and slot count, case and motherboard form factor, GPU
// clearance, cooler clearance, PSU headroom and connectors, storage
// interface, OS support.
//
// Rather than hardcode each as a function, a rule is data: compare
// attribute X on the left category against attribute Y on the right, using
// an operator. That way a new rule is a row, and §7.3's list can grow
// without a deploy.
//
// `severity` implements the distinction §7.3 demands: a hard incompatibility
// BLOCKS submission, a recommendation warns and can be overridden after the
// customer acknowledges it.

const CompatibilityRule = model
  .define({ name: "CompatibilityRule", tableName: "build_compatibility_rule" }, {
    id: model.id({ prefix: "brul" }).primaryKey(),
    code: model.text().unique(),

    left_category: model.text(),
    left_attribute: model.text(),
    right_category: model.text(),
    right_attribute: model.text(),

    // "equals"      — socket must match chipset socket
    // "in"          — memory type must appear in the board's supported list
    // "lte" / "gte" — GPU length <= case clearance; PSU wattage >= draw
    // "sum_lte"     — total of left across picks <= right (slots, capacity)
    // "count_lte"   — number of picks <= right (RAM sticks, M.2 drives)
    operator: model.text(),

    // "blocking" | "warning"
    severity: model.text().default("blocking"),

    // Shown to the customer. §7.10 requires the system EXPLAIN every
    // blocking failure, so this is a sentence, not a rule name.
    message: model.text(),
    // What to do about it — the difference between a dead end and a fix.
    remedy: model.text().nullable(),

    // Headroom applied before comparing, e.g. PSU wattage 1.3x the draw.
    factor: model.number().nullable(),

    is_active: model.boolean().default(true),
  })
  .indexes([
    { on: ["code"], unique: true },
    { on: ["left_category"] },
    { on: ["right_category"] },
    { on: ["is_active"] },
  ])

export default CompatibilityRule
