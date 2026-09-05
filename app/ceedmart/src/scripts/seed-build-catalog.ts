import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../modules/build-catalog"
import { DEFAULT_COMPATIBILITY_RULES } from "../lib/build-catalog/default-rules"

// Seeds the component slots and compatibility rules for the guided builder
// (BRD §7.3, §7.4).
//
// Idempotent — safe to re-run after adding a rule. Only the slots and rules
// are seeded; the OPTIONS in each slot are real parts with real prices and
// belong to whoever maintains the catalogue, not to a script.
//
//   npx medusa exec ./src/scripts/seed-build-catalog.ts

const CATEGORIES = [
  { code: "cpu", label: "Processor", applies_to: "desktop", is_required: true, sort_order: 10, help_text: "The engine of the machine. More cores help with editing and rendering; higher clock speed helps with games." },
  { code: "motherboard", label: "Motherboard", applies_to: "desktop", is_required: true, sort_order: 20, help_text: "Everything plugs into this. It has to match your processor's socket." },
  { code: "memory", label: "Memory (RAM)", applies_to: "desktop", is_required: true, allows_multiple: true, max_quantity: 4, sort_order: 30, help_text: "How much the machine can juggle at once. 16GB is comfortable; 32GB+ for heavy editing." },
  { code: "gpu", label: "Graphics card", applies_to: "desktop", is_required: false, sort_order: 40, help_text: "Needed for gaming, 3D and video work. Office machines can skip it." },
  { code: "storage", label: "Storage", applies_to: "both", is_required: true, allows_multiple: true, max_quantity: 4, sort_order: 50, help_text: "Where everything lives. An NVMe drive makes the whole machine feel faster." },
  { code: "psu", label: "Power supply", applies_to: "desktop", is_required: true, sort_order: 60, help_text: "Powers everything. Sized to your parts with room to spare." },
  { code: "case", label: "Case", applies_to: "desktop", is_required: true, sort_order: 70, help_text: "Has to be big enough for your motherboard, graphics card and cooler." },
  { code: "cpu_cooler", label: "CPU cooling", applies_to: "desktop", is_required: true, sort_order: 80, help_text: "Keeps the processor in range under load." },
  { code: "case_cooling", label: "Case fans", applies_to: "desktop", is_required: false, allows_multiple: true, max_quantity: 6, sort_order: 90 },
  { code: "operating_system", label: "Operating system", applies_to: "both", is_required: true, sort_order: 100 },
  { code: "monitor", label: "Monitor", applies_to: "both", is_required: false, allows_multiple: true, max_quantity: 3, sort_order: 110 },
  { code: "peripherals", label: "Keyboard & mouse", applies_to: "both", is_required: false, allows_multiple: true, max_quantity: 4, sort_order: 120 },
  { code: "networking", label: "Networking", applies_to: "both", is_required: false, sort_order: 130, help_text: "Wi-Fi or a faster wired card, if the motherboard's built-in option isn't enough." },
  { code: "services", label: "Setup & services", applies_to: "both", is_required: false, allows_multiple: true, max_quantity: 6, sort_order: 140, help_text: "Assembly, software setup, data transfer from your old machine, extended testing." },

  // Laptop slots — configurable only where the manufacturer allows it.
  { code: "laptop_model", label: "Model", applies_to: "laptop", is_required: true, sort_order: 10 },
  { code: "laptop_cpu", label: "Processor", applies_to: "laptop", is_required: true, sort_order: 20 },
  { code: "laptop_memory", label: "Memory", applies_to: "laptop", is_required: true, sort_order: 30 },
  { code: "laptop_display", label: "Screen", applies_to: "laptop", is_required: true, sort_order: 40 },
  { code: "laptop_keyboard", label: "Keyboard layout", applies_to: "laptop", is_required: false, sort_order: 50 },
  { code: "laptop_battery", label: "Battery & charger", applies_to: "laptop", is_required: false, sort_order: 60 },
]

export default async function seedBuildCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)

  let createdCategories = 0
  for (const category of CATEGORIES) {
    const [existing] = await svc.listComponentCategories(
      { code: category.code },
      { take: 1 }
    )
    if (existing) {
      await svc.updateComponentCategories({ id: existing.id, ...category })
      continue
    }
    await svc.createComponentCategories(category)
    createdCategories++
  }

  let createdRules = 0
  for (const rule of DEFAULT_COMPATIBILITY_RULES) {
    const [existing] = await svc.listCompatibilityRules(
      { code: rule.code },
      { take: 1 }
    )
    if (existing) {
      await svc.updateCompatibilityRules({ id: existing.id, ...rule })
      continue
    }
    await svc.createCompatibilityRules(rule)
    createdRules++
  }

  logger.info(
    `[seed-build-catalog] ${CATEGORIES.length} slots (${createdCategories} new), ` +
      `${DEFAULT_COMPATIBILITY_RULES.length} rules (${createdRules} new). ` +
      `Add component options in admin — they are real parts with real prices.`
  )
}
