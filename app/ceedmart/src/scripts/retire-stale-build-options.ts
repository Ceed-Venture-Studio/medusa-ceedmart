import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../modules/build-catalog"
import { CATEGORIES, OPTIONS } from "../lib/build-catalog/catalog-data"

// Withdraw component options that the catalogue definition no longer lists.
//
// ── Why this exists ─────────────────────────────────────────────────────
// seed-build-catalog upserts by (category, label): it creates what is
// missing and updates what has changed, and it never removes anything. That
// is the right behaviour for a seed — deleting rows that live build requests
// point at would break them — but it means a REPLACED catalogue leaves the
// old one sitting beside the new.
//
// After seeding the Nigerian laptop specification, that showed up as a
// processor list of 27 entries: the twenty specified groups plus seven
// placeholders from the original scaffold. Among them, "Apple M3" offered
// inside a desktop tower — a machine Apple has never made.
//
// ── Deactivate, never delete ────────────────────────────────────────────
// is_active=false hides an option from /store/builds/catalog, which already
// filters on it, while leaving the row intact for any saved configuration
// that references it. A customer's earlier build still renders; nobody can
// pick it again.
//
// Dry by default — pass `apply`:
//
//   npx medusa exec ./src/scripts/retire-stale-build-options.ts
//   npx medusa exec ./src/scripts/retire-stale-build-options.ts apply
//
// Bare words, not --flags: `medusa exec` declares its arguments as a yargs
// positional, so anything starting with -- is eaten by the CLI.

export default async function retireStaleBuildOptions({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc: any = container.resolve(BUILD_CATALOG_MODULE)

  const apply = (args ?? [])
    .map((a: string) => a.replace(/^--/, ""))
    .includes("apply")

  // Keyed on category CODE plus label, because ids differ between databases
  // and the definition is written in codes.
  const wanted = new Set(
    OPTIONS.map((o) => `${o.category}::${o.label.trim().toLowerCase()}`)
  )

  const categories = await svc.listComponentCategories({}, { take: 1000 })
  const codeById = new Map<string, string>(
    (categories as any[]).map((c) => [c.id, c.code])
  )

  const options = await svc.listComponentOptions(
    { is_active: true },
    { take: 5000 }
  )

  const stale = (options as any[]).filter((o) => {
    const code = codeById.get(o.category_id)
    if (!code) return false // orphan of a deleted slot; leave it alone
    return !wanted.has(`${code}::${String(o.label).trim().toLowerCase()}`)
  })

  logger.info(
    `[retire-options] ${options.length} active option(s), ${stale.length} not in the catalogue definition`
  )

  const byCategory: Record<string, string[]> = {}
  for (const o of stale) {
    const code = codeById.get(o.category_id) || "(unknown)"
    ;(byCategory[code] ??= []).push(o.label)
  }
  for (const [code, labels] of Object.entries(byCategory)) {
    logger.info(`  ${code}: ${labels.join(", ")}`)
  }

  if (!stale.length) {
    logger.info("[retire-options] nothing to withdraw.")
    return
  }

  if (!apply) {
    logger.info("[retire-options] DRY RUN — nothing changed. Re-run with `apply`.")
    return
  }

  for (const o of stale) {
    await svc.updateComponentOptions({ id: o.id, is_active: false })
  }
  logger.info(`[retire-options] deactivated ${stale.length} option(s).`)
}
