import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUILD_CATALOG_MODULE } from "../../../../modules/build-catalog"
import { loadCategories } from "../../../../lib/build-catalog/load"
import { FEATURE_FLAGS, assertEnabled } from "../../../../lib/feature-flags"

// The component catalogue for the guided configurator (BRD §7.3, §7.4).
//
// Options are grouped by slot and carry their attributes, so the browser can
// give immediate feedback as parts are picked. The server still re-validates
// on save and on submit (§7.9) — this payload is for responsiveness, not
// authority.
//
// `is_fixed` options are returned but flagged, so the UI can show a laptop's
// soldered memory without implying it can be changed (§7.4).

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.BUILD_CONFIGURATOR)

  const buildType = req.query.build_type === "laptop" ? "laptop" : "desktop"
  const modelFamily =
    typeof req.query.model_family === "string" ? req.query.model_family : null

  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const categories = await loadCategories(req.scope, buildType)

  const filters: Record<string, unknown> = {
    category_id: categories.map((c) => c.id),
    is_active: true,
  }

  const options = await svc.listComponentOptions(filters, {
    order: { sort_order: "ASC" },
    take: 1000,
  })

  const byCategory = new Map<string, any[]>()
  for (const option of options as any[]) {
    // Laptop options are scoped to a model family; a family-specific part
    // must not appear under a different machine.
    if (option.model_family && option.model_family !== modelFamily) continue

    const list = byCategory.get(option.category_id) ?? []
    list.push({
      id: option.id,
      label: option.label,
      brand: option.brand,
      variant_id: option.variant_id,
      attributes: option.attributes ?? {},
      is_fixed: option.is_fixed,
    })
    byCategory.set(option.category_id, list)
  }

  res.json({
    build_type: buildType,
    categories: categories.map((c) => ({
      code: c.code,
      label: c.label,
      is_required: c.is_required,
      allows_multiple: c.allows_multiple,
      max_quantity: c.max_quantity,
      help_text: c.help_text,
      options: byCategory.get(c.id) ?? [],
    })),
  })
}
