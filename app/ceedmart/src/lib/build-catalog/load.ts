import type { MedusaContainer } from "@medusajs/framework/types"
import { BUILD_CATALOG_MODULE } from "../../modules/build-catalog"
import type { Pick, Rule } from "./compatibility"

// Shared loaders for the configurator, used by both the catalogue endpoint
// and the server-side validator so the two can never disagree about what
// the rules are (§7.9 requires validation be repeated on the server).

export const loadRules = async (
  container: MedusaContainer
): Promise<Rule[]> => {
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)
  const rows = await svc.listCompatibilityRules({ is_active: true }, { take: 500 })

  return (rows as any[]).map((r) => ({
    code: r.code,
    left_category: r.left_category,
    left_attribute: r.left_attribute,
    right_category: r.right_category,
    right_attribute: r.right_attribute,
    operator: r.operator,
    severity: r.severity,
    message: r.message,
    remedy: r.remedy,
    factor: r.factor === null ? null : Number(r.factor),
    is_active: r.is_active,
  }))
}

export const loadCategories = async (
  container: MedusaContainer,
  buildType: "desktop" | "laptop"
): Promise<any[]> => {
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)
  const rows = await svc.listComponentCategories(
    { applies_to: [buildType, "both"] },
    { order: { sort_order: "ASC" }, take: 100 }
  )
  return rows as any[]
}

/**
 * Turn a customer's selections into picks the engine can evaluate.
 *
 * Attributes are read from the CATALOGUE, never from the request body — a
 * client that could supply its own attributes could declare any two parts
 * compatible.
 */
export const resolvePicks = async (
  container: MedusaContainer,
  selections: { category_code: string; option_id: string; quantity?: number }[]
): Promise<{ picks: Pick[]; prices: Record<string, number | null> }> => {
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)

  const optionIds = [...new Set(selections.map((s) => s.option_id))].filter(Boolean)
  if (!optionIds.length) return { picks: [], prices: {} }

  const options = await svc.listComponentOptions({ id: optionIds }, { take: 200 })
  const byId = new Map<string, any>((options as any[]).map((o) => [o.id, o]))

  const picks: Pick[] = []
  const prices: Record<string, number | null> = {}

  for (const selection of selections) {
    const option = byId.get(selection.option_id)
    if (!option) continue

    picks.push({
      category_code: selection.category_code,
      option_id: option.id,
      label: option.label,
      quantity: Math.max(1, Number(selection.quantity) || 1),
      attributes: option.attributes ?? null,
    })

    prices[option.id] =
      option.indicative_price === null || option.indicative_price === undefined
        ? null
        : Number(option.indicative_price)
  }

  return { picks, prices }
}
