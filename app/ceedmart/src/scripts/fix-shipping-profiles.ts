import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// Give every product a shipping profile that a shipping option actually
// serves.
//
// ── Why checkout was failing ────────────────────────────────────────────
// validateShippingStep (core-flows/cart/steps/validate-shipping.ts) collects
// the shipping profile of every item that requires shipping, collects the
// profiles served by the chosen shipping methods, and throws if any required
// profile is missing:
//
//   "The cart items require shipping profiles that are not satisfied by the
//    current shipping methods"
//
// Two ways to trip it, and this database had both:
//
//   1. A product with NO profile linked. Its required profile reads as
//      `undefined`, and `available.includes(undefined)` is false, so the cart
//      throws no matter which shipping method the customer picked. There is
//      no combination that works — the product is simply unbuyable.
//
//   2. A product on a profile that no shipping option serves. Same throw,
//      same dead end, but only for that profile.
//
// ── What it does ────────────────────────────────────────────────────────
// Links every unlinked product to the default profile, and moves products
// off profiles that no shipping option serves. Both are data repairs; the
// validation itself is correct and stays as it is.
//
// Dry by default — pass `apply`:
//
//   npx medusa exec ./src/scripts/fix-shipping-profiles.ts
//   npx medusa exec ./src/scripts/fix-shipping-profiles.ts apply
//
// Bare words, not --flags: `medusa exec` declares its arguments as a yargs
// positional, so anything starting with -- is eaten by the CLI.

export default async function fixShippingProfiles({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const apply = (args ?? [])
    .map((a: string) => a.replace(/^--/, ""))
    .includes("apply")

  // ── Which profiles can actually be delivered? ─────────────────────────
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "shipping_profile_id"],
  })
  const served = new Set(
    (options as any[]).map((o) => o.shipping_profile_id).filter(Boolean)
  )

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })

  logger.info("[shipping-profiles] profiles and whether an option serves them:")
  for (const p of profiles as any[]) {
    logger.info(
      `  ${p.name} (${p.type}) ${served.has(p.id) ? "— served" : "— NO OPTION SERVES THIS"}`
    )
  }

  // The default profile is the destination for repairs. Prefer the one typed
  // "default"; fall back to any served profile so this still works in an
  // environment that named things differently.
  const defaultProfile =
    (profiles as any[]).find((p) => p.type === "default" && served.has(p.id)) ??
    (profiles as any[]).find((p) => served.has(p.id))

  if (!defaultProfile) {
    logger.error(
      "[shipping-profiles] no shipping profile has a shipping option serving it. " +
        "Create a shipping option first — there is nothing safe to link products to."
    )
    return
  }
  logger.info(`[shipping-profiles] repairing onto: ${defaultProfile.name}`)

  // ── Find the broken products ──────────────────────────────────────────
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "shipping_profile.id", "shipping_profile.name"],
  })

  const unlinked: any[] = []
  const stranded: any[] = []

  for (const p of products as any[]) {
    const profileId = p.shipping_profile?.id
    if (!profileId) {
      unlinked.push(p)
    } else if (!served.has(profileId)) {
      stranded.push(p)
    }
  }

  logger.info(
    `[shipping-profiles] ${unlinked.length} product(s) with no profile, ` +
      `${stranded.length} on a profile no option serves, of ${(products as any[]).length} total`
  )
  for (const p of stranded) {
    logger.info(`  stranded: ${p.title} (on ${p.shipping_profile?.name})`)
  }

  if (!unlinked.length && !stranded.length) {
    logger.info("[shipping-profiles] nothing to repair")
    return
  }

  if (!apply) {
    logger.info(
      "[shipping-profiles] DRY RUN — nothing changed. Re-run with `apply`."
    )
    return
  }

  // ── Repair ────────────────────────────────────────────────────────────
  // Dismiss first, then create: a product carries at most one profile, so a
  // stranded product must lose its old link before it gains the new one.
  for (const p of stranded) {
    await link.dismiss({
      [Modules.PRODUCT]: { product_id: p.id },
      [Modules.FULFILLMENT]: { shipping_profile_id: p.shipping_profile.id },
    })
  }

  const toLink = [...unlinked, ...stranded]
  await link.create(
    toLink.map((p) => ({
      [Modules.PRODUCT]: { product_id: p.id },
      [Modules.FULFILLMENT]: { shipping_profile_id: defaultProfile.id },
    }))
  )

  logger.info(
    `[shipping-profiles] linked ${toLink.length} product(s) to ${defaultProfile.name}`
  )
}
