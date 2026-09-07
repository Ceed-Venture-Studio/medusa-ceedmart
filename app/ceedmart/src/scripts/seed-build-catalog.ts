import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../modules/build-catalog"
import { DEFAULT_COMPATIBILITY_RULES } from "../lib/build-catalog/default-rules"
import { CATEGORY_SCHEMAS } from "../lib/build-catalog/schema"
import {
  BUILD_TYPES,
  CATEGORIES,
  OPTIONS,
} from "../lib/build-catalog/catalog-data"

// Seeds the component slots and compatibility rules for the guided builder
// (BRD §7.3, §7.4).
//
// Idempotent — safe to re-run after adding a rule. Only the slots and rules
// are seeded; the OPTIONS in each slot are real parts, and they belong to
// whoever maintains the catalogue, not to a script.
//
//   npx medusa exec ./src/scripts/seed-build-catalog.ts

export default async function seedBuildCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)

  let createdTypes = 0
  for (const type of BUILD_TYPES) {
    const [existing] = await svc.listBuildTypes({ code: type.code }, { take: 1 })
    if (existing) {
      await svc.updateBuildTypes({ id: existing.id, ...type })
      continue
    }
    await svc.createBuildTypes({ ...type, is_active: true })
    createdTypes++
  }

  let createdCategories = 0
  for (const category of CATEGORIES) {
    const schema = CATEGORY_SCHEMAS.find((c) => c.code === category.code)
    const payload = {
      ...category,
      // Slots carry their build types as an array — most are shared, and
      // the old single-value enum could not say so.
      build_types:
        category.applies_to === "both"
          ? ["desktop", "laptop"]
          : category.applies_to === "retired"
            ? []
            : [category.applies_to],
      // The field definitions the admin form renders and the importer
      // validates against. A category may override these in the database;
      // seeding only fills them in.
      attribute_schema: schema?.fields ?? null,
    }

    const [existing] = await svc.listComponentCategories(
      { code: category.code },
      { take: 1 }
    )
    if (existing) {
      await svc.updateComponentCategories({ id: existing.id, ...payload })
      continue
    }
    await svc.createComponentCategories(payload)
    createdCategories++
  }

  // ── Options ────────────────────────────────────────────────────────────
  // Seeded so a fresh database has something selectable in every slot.
  // Matched on (category, label) because that is what a person means by
  // "the same part"; ids differ between environments and always will.
  //
  // Existing rows are UPDATED rather than skipped, so correcting a spec or
  // an attribute here reaches every environment on the next run. Options
  // ops has added by hand are left alone — nothing is deleted.
  const categoriesByCode = new Map<string, any>()
  for (const c of await svc.listComponentCategories({}, { take: 500 })) {
    categoriesByCode.set(c.code, c)
  }

  let createdOptions = 0
  let updatedOptions = 0
  for (const option of OPTIONS) {
    const category = categoriesByCode.get(option.category)
    if (!category) {
      logger.warn(
        `[build-catalog] option "${option.label}" references unknown slot "${option.category}" — skipped`
      )
      continue
    }

    const payload = {
      category_id: category.id,
      label: option.label,
      brand: option.brand ?? null,
      attributes: option.attributes ?? null,
      sort_order: option.sort_order ?? 0,
      is_active: true,
    }

    const [existing] = await svc.listComponentOptions(
      { category_id: category.id, label: option.label },
      { take: 1 }
    )
    if (existing) {
      await svc.updateComponentOptions({ id: existing.id, ...payload })
      updatedOptions++
      continue
    }
    await svc.createComponentOptions(payload)
    createdOptions++
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
    `[build-catalog] options: ${createdOptions} created, ${updatedOptions} updated`
  )
  logger.info(
    `[seed-build-catalog] ${BUILD_TYPES.length} build types (${createdTypes} new), ` +
      `${CATEGORIES.length} slots (${createdCategories} new), ` +
      `${DEFAULT_COMPATIBILITY_RULES.length} rules (${createdRules} new). ` +
      `Add parts under Build Catalogue in admin — by hand or by CSV.`
  )
}
