import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateStoresWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  DEFAULT_HERO_CARDS,
  HERO_CARD_ICONS,
  HERO_CARDS_METADATA_KEY,
  MAX_HERO_CARDS,
  heroCardsFromMetadata,
  parseHeroCards,
} from "../../../../lib/banner/hero-cards"
import { revalidateStorefront } from "../../../../lib/storefront-revalidate"

// GET  /admin/banners/hero-cards — the cards under the home hero
// POST /admin/banners/hero-cards — { cards: [...] } to save, { cards: null }
//                                  to go back to the built-in defaults
// See lib/banner/hero-cards.

const loadStore = async (req: AuthenticatedMedusaRequest<any>) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "store", fields: ["id", "metadata"] })
  const store = (data as any[])[0]
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "No store")
  return store
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const store = await loadStore(req)
  res.json({
    ...heroCardsFromMetadata(store.metadata),
    defaults: DEFAULT_HERO_CARDS,
    icons: HERO_CARD_ICONS,
    max: MAX_HERO_CARDS,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<{ cards: unknown }>,
  res: MedusaResponse
) => {
  const body = req.body ?? ({} as any)
  if (!("cards" in body)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "cards is required (a list, or null to reset)")
  }
  const cards = body.cards === null ? null : parseHeroCards(body.cards)

  const store = await loadStore(req)
  // Merge: store metadata is shared with other settings (e.g. metadata.pos).
  const metadata = { ...(store.metadata ?? {}) }
  const home = { ...(metadata[HERO_CARDS_METADATA_KEY] ?? {}) }
  if (cards === null) delete home.hero_cards
  else home.hero_cards = cards
  metadata[HERO_CARDS_METADATA_KEY] = home

  await updateStoresWorkflow(req.scope).run({
    input: { selector: { id: store.id }, update: { metadata } },
  })
  await revalidateStorefront(req.scope, ["banners"], "hero-cards")

  res.json(heroCardsFromMetadata(metadata))
}
