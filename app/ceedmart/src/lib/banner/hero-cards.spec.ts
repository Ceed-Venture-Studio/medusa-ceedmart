import {
  DEFAULT_HERO_CARDS,
  heroCardsFromMetadata,
  parseHeroCards,
} from "./hero-cards"

const card = (over: Record<string, any> = {}) => ({
  icon: "delivery",
  title: "Free delivery",
  body: "On qualifying orders",
  link_url: null,
  accent_color: null,
  ...over,
})

describe("parseHeroCards", () => {
  it("accepts up to four cards and trims text", () => {
    const out = parseHeroCards([
      card({ title: "  Fast  ", body: "   " }),
      card({ icon: "whatsapp", link_url: "https://wa.me/1", accent_color: "#25D366" }),
    ])
    expect(out[0]).toEqual({
      icon: "delivery",
      title: "Fast",
      body: null,
      link_url: null,
      accent_color: null,
    })
    expect(out[1].accent_color).toBe("#25D366")
  })

  it("accepts an empty list (all cards removed)", () => {
    expect(parseHeroCards([])).toEqual([])
  })

  it("rejects more than four, unknown icons, missing titles and bad links/colours", () => {
    expect(() => parseHeroCards([card(), card(), card(), card(), card()])).toThrow(/At most 4/)
    expect(() => parseHeroCards([card({ icon: "rocket" })])).toThrow(/icon must be/)
    expect(() => parseHeroCards([card({ title: " " })])).toThrow(/title is required/)
    expect(() => parseHeroCards([card({ link_url: "javascript:alert(1)" })])).toThrow(/link must/)
    expect(() => parseHeroCards([card({ accent_color: "green" })])).toThrow(/hex/)
    expect(() => parseHeroCards({})).toThrow(/list/)
  })
})

describe("heroCardsFromMetadata", () => {
  it("falls back to the defaults when nothing was saved", () => {
    expect(heroCardsFromMetadata(null)).toEqual({ cards: DEFAULT_HERO_CARDS, is_default: true })
  })

  it("returns saved cards, including an empty list", () => {
    expect(heroCardsFromMetadata({ ceedmart_home: { hero_cards: [] } })).toEqual({
      cards: [],
      is_default: false,
    })
  })

  it("falls back rather than failing on a malformed saved value", () => {
    expect(
      heroCardsFromMetadata({ ceedmart_home: { hero_cards: [{ icon: "nope" }] } }).is_default
    ).toBe(true)
  })
})
