import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { BUILD_CATALOG_MODULE } from "../../../../modules/build-catalog"
import { schemaFor } from "../../../../lib/build-catalog/schema"

// Component slots, with the schema that describes their parts (BRD §7.3).
//
// The schema is served from code rather than the row when the row has none,
// so an existing category picks up new field definitions without a data
// migration. A category that overrides it in the database wins — that is
// how a future build type customises its own slots without touching this
// repo (§7.1).

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)

  const buildType =
    typeof req.query.build_type === "string" ? req.query.build_type : null

  const [categories, types] = await Promise.all([
    svc.listComponentCategories({}, { order: { sort_order: "ASC" }, take: 200 }),
    svc.listBuildTypes({ is_active: true }, { order: { sort_order: "ASC" }, take: 50 }),
  ])

  const ids = (categories as any[]).map((c) => c.id)
  const options = ids.length
    ? await svc.listComponentOptions({ category_id: ids }, { take: 2000 })
    : []

  const counts = new Map<string, number>()
  for (const o of options as any[]) {
    counts.set(o.category_id, (counts.get(o.category_id) ?? 0) + 1)
  }

  const rows = (categories as any[])
    .map((c) => ({
      ...c,
      build_types: c.build_types ?? [c.applies_to],
      attribute_schema: c.attribute_schema ?? schemaFor(c.code),
      option_count: counts.get(c.id) ?? 0,
    }))
    .filter((c) => !buildType || (c.build_types as string[]).includes(buildType))

  res.json({ categories: rows, build_types: types })
}
