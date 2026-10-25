import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Ask the storefront to drop its Next.js cache for the given tags.
 *
 * Wiring:
 *   STOREFRONT_REVALIDATE_URL = https://<storefront>/api/revalidate
 *   REVALIDATE_SECRET         = <shared secret, also set on storefront>
 *
 * If either env var is missing this no-ops silently — useful in dev where
 * you don't have a storefront running. Never throws: a storefront that is
 * unreachable must not break the workflow that changed the data.
 */
export const revalidateStorefront = async (
  container: MedusaContainer,
  tags: string[],
  label: string
): Promise<void> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const url = process.env.STOREFRONT_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret || !tags.length) return

  const params = new URLSearchParams()
  for (const t of tags) params.append("tag", t)

  try {
    const res = await fetch(`${url}?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (!res.ok) {
      logger.warn(
        `[storefront-revalidate] ${label} → ${res.status} ${res.statusText}`
      )
      return
    }
    logger.debug(
      `[storefront-revalidate] ${label} → revalidated [${tags.join(", ")}]`
    )
  } catch (err: any) {
    logger.warn(
      `[storefront-revalidate] ${label} fetch failed: ${err?.message ?? err}`
    )
  }
}
