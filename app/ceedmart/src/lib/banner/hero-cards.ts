import { MedusaError } from "@medusajs/framework/utils"

// The cards under the home hero (free delivery, 24/7 support, …).
//
// One list for the whole site, shown under both the hero carousel and the
// built-in hero that appears when no slide is active. Edited on the admin
// Banners page; stored on the store record at metadata.ceedmart_home, since
// it is a handful of settings rather than something with its own lifecycle.
//
// Icons are picked from a fixed set the storefront knows how to draw —
// keep HERO_CARD_ICONS in step with the storefront's hero-cards component.

export const HERO_CARD_ICONS = [
  "delivery",
  "support",
  "plane",
  "whatsapp",
  "tag",
  "shield",
  "clock",
  "star",
] as const
export type HeroCardIcon = (typeof HERO_CARD_ICONS)[number]

export type HeroCard = {
  icon: HeroCardIcon
  title: string
  body: string | null
  /** Where the card goes when clicked; null means not clickable. */
  link_url: string | null
  /** Card background (hex). Null is the standard translucent card. */
  accent_color: string | null
}

export const MAX_HERO_CARDS = 4
export const HERO_CARDS_METADATA_KEY = "ceedmart_home"

/** What the home page showed before the cards were editable. */
export const DEFAULT_HERO_CARDS: HeroCard[] = [
  {
    icon: "delivery",
    title: "Free delivery over ₦30,000",
    body: "No delivery charge on qualifying orders.",
    link_url: null,
    accent_color: null,
  },
  {
    icon: "support",
    title: "24/7 support",
    body: "Reach a real person any time, day or night.",
    link_url: null,
    accent_color: null,
  },
  {
    icon: "plane",
    title: "Pre-order from the US",
    body: "Flown in for you, with duty already in the price.",
    link_url: null,
    accent_color: null,
  },
  {
    icon: "whatsapp",
    title: "Chat with support",
    body: "Message us on WhatsApp",
    link_url:
      "https://wa.me/2347087502195?text=" +
      encodeURIComponent("Hello CeedMart, I'd like some help with an order."),
    accent_color: "#25D366",
  },
]

const HEX = /^#[0-9a-fA-F]{6}$/
const LINK = /^(\/|https?:\/\/|mailto:|tel:)/i

const invalid = (msg: string) => new MedusaError(MedusaError.Types.INVALID_DATA, msg)

const text = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v !== "string") throw invalid("Card text fields must be strings")
  const t = v.trim()
  return t.length ? t : null
}

/** Validate and normalise a card list from the admin. Throws INVALID_DATA. */
export const parseHeroCards = (input: unknown): HeroCard[] => {
  if (!Array.isArray(input)) throw invalid("cards must be a list")
  if (input.length > MAX_HERO_CARDS) {
    throw invalid(`At most ${MAX_HERO_CARDS} cards`)
  }
  return input.map((raw: any, i) => {
    const n = i + 1
    if (!raw || typeof raw !== "object") throw invalid(`Card ${n} is not an object`)
    if (!HERO_CARD_ICONS.includes(raw.icon)) {
      throw invalid(`Card ${n}: icon must be one of ${HERO_CARD_ICONS.join(", ")}`)
    }
    const title = text(raw.title)
    if (!title) throw invalid(`Card ${n}: title is required`)
    if (title.length > 60) throw invalid(`Card ${n}: title is over 60 characters`)
    const body = text(raw.body)
    if (body && body.length > 120) throw invalid(`Card ${n}: text is over 120 characters`)
    const link_url = text(raw.link_url)
    if (link_url && !LINK.test(link_url)) {
      throw invalid(`Card ${n}: link must start with /, http(s)://, mailto: or tel:`)
    }
    const accent_color = text(raw.accent_color)
    if (accent_color && !HEX.test(accent_color)) {
      throw invalid(`Card ${n}: colour must be a hex value like #25D366`)
    }
    return { icon: raw.icon, title, body, link_url, accent_color }
  })
}

/** Cards from store metadata, or the defaults when none were ever saved. */
export const heroCardsFromMetadata = (
  metadata: Record<string, any> | null | undefined
): { cards: HeroCard[]; is_default: boolean } => {
  const saved = metadata?.[HERO_CARDS_METADATA_KEY]?.hero_cards
  if (!Array.isArray(saved)) return { cards: DEFAULT_HERO_CARDS, is_default: true }
  try {
    return { cards: parseHeroCards(saved), is_default: false }
  } catch {
    // A hand-edited, malformed value must not take the home page down.
    return { cards: DEFAULT_HERO_CARDS, is_default: true }
  }
}
