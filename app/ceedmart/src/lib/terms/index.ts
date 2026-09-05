import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { TERMS_MODULE, type TermsSlug } from "../../modules/terms"

// Helpers for the terms lifecycle (BRD §5.3, §6.6).
//
// Two rules the rest of the codebase depends on:
//
//   1. A transaction accepts the CURRENT version, resolved server-side. The
//      client never chooses which version it agreed to.
//   2. Acceptance is recorded against the transaction, so the exact wording
//      can be reproduced later. §5.5 forbids altering that record.

export type AcceptanceEvidence = {
  ip?: string | null
  userAgent?: string | null
}

/** The version customers are currently accepting for a document. */
export const getCurrentVersion = async (
  container: MedusaContainer,
  slug: TermsSlug
): Promise<any | null> => {
  const terms: any = container.resolve(TERMS_MODULE)

  const [doc] = await terms.listTermsDocuments({ slug }, { take: 1 })
  if (!doc) return null

  const [version] = await terms.listTermsVersions(
    { document_id: doc.id, is_current: true },
    { take: 1 }
  )
  return version ?? null
}

/**
 * Resolve the current version or fail loudly.
 *
 * Checkout must not silently proceed without terms when the BRD requires
 * acceptance — a missing terms document is a configuration error, not a
 * reason to skip consent.
 */
export const requireCurrentVersion = async (
  container: MedusaContainer,
  slug: TermsSlug
): Promise<any> => {
  const version = await getCurrentVersion(container, slug)
  if (!version) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No published terms found for "${slug}". Publish a version before enabling this flow.`
    )
  }
  return version
}

/**
 * Record that a customer accepted the current terms for a transaction.
 *
 * Returns the version id so the caller can snapshot it onto the order
 * metadata (`ceedmart.terms_version_id`).
 */
export const recordAcceptance = async (
  container: MedusaContainer,
  args: {
    slug: TermsSlug
    entityType: string
    entityId: string
    customerId?: string | null
    contact?: string | null
    evidence?: AcceptanceEvidence
  }
): Promise<string> => {
  const terms: any = container.resolve(TERMS_MODULE)
  const version = await requireCurrentVersion(container, args.slug)

  // Idempotent — a retried checkout must not stack duplicate acceptances
  // for the same transaction and version.
  const existing = await terms.listTermsAcceptances(
    {
      entity_type: args.entityType,
      entity_id: args.entityId,
      version_id: version.id,
    },
    { take: 1 }
  )
  if (existing?.length) return version.id

  await terms.createTermsAcceptances({
    version_id: version.id,
    document_slug: args.slug,
    customer_id: args.customerId ?? null,
    contact: args.contact ?? null,
    entity_type: args.entityType,
    entity_id: args.entityId,
    accepted_at: new Date(),
    ip_address: args.evidence?.ip ?? null,
    user_agent: args.evidence?.userAgent ?? null,
  })

  return version.id
}

/**
 * Publish a new version of a document, creating the document if needed.
 *
 * Clears `is_current` on the previous version first — the partial unique
 * index in the migration rejects two current versions, so the order matters.
 */
export const publishVersion = async (
  container: MedusaContainer,
  args: {
    slug: TermsSlug
    name: string
    body: string
    changeNote?: string | null
  }
): Promise<any> => {
  const terms: any = container.resolve(TERMS_MODULE)

  let [doc] = await terms.listTermsDocuments({ slug: args.slug }, { take: 1 })
  if (!doc) {
    doc = await terms.createTermsDocuments({
      slug: args.slug,
      name: args.name,
    })
  }

  const previous = await terms.listTermsVersions(
    { document_id: doc.id },
    { order: { version: "DESC" }, take: 1 }
  )
  const lastVersion = previous?.[0]?.version ?? 0

  if (previous?.[0]?.is_current) {
    await terms.updateTermsVersions({ id: previous[0].id, is_current: false })
  }

  return await terms.createTermsVersions({
    document_id: doc.id,
    version: lastVersion + 1,
    body: args.body,
    change_note: args.changeNote ?? null,
    published_at: new Date(),
    is_current: true,
  })
}

/** Evidence from an Express-style request, for API route call sites. */
export const evidenceFromRequest = (req: any): AcceptanceEvidence => ({
  ip:
    (req?.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req?.ip ||
    null,
  userAgent: (req?.headers?.["user-agent"] as string) ?? null,
})
