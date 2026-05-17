// Canonical banner slots. Each slot corresponds to a specific placement on
// the storefront and enforces strict image dimensions on upload. Adding a
// slot here is a code change that should pair with the storefront component
// that renders it — keeps banner data and storefront layout in sync.

export type BannerSlot = {
  key: string
  label: string
  aspect_ratio: number     // width / height
  min_width: number        // px
  min_height: number       // px
  description: string
}

export const BANNER_SLOTS: BannerSlot[] = [
  {
    key: "home_hero_desktop",
    label: "Home Hero (desktop)",
    aspect_ratio: 21 / 9,
    min_width: 1920,
    min_height: 823,
    description: "Top of the home page on desktop. Ultra-wide hero shot.",
  },
  {
    key: "home_hero_mobile",
    label: "Home Hero (mobile)",
    aspect_ratio: 4 / 5,
    min_width: 800,
    min_height: 1000,
    description: "Top of the home page on mobile. Portrait orientation.",
  },
  {
    key: "home_secondary",
    label: "Home Secondary",
    aspect_ratio: 1,
    min_width: 600,
    min_height: 600,
    description: "Home page secondary slot — typically 3-up square row.",
  },
  {
    key: "category_banner",
    label: "Category Page Banner",
    aspect_ratio: 4,
    min_width: 1200,
    min_height: 300,
    description: "Top of a category page. Wide banner with text overlay.",
  },
  {
    key: "promo_strip",
    label: "Promo Strip",
    aspect_ratio: 32 / 3,
    min_width: 1920,
    min_height: 180,
    description: "Site-wide announcement bar. Ultra-thin and ultra-wide.",
  },
  {
    key: "product_sidebar",
    label: "Product Page Sidebar",
    aspect_ratio: 3 / 4,
    min_width: 600,
    min_height: 800,
    description: "Sidebar of the product detail page. Portrait orientation.",
  },
]

const slotsByKey = new Map<string, BannerSlot>(
  BANNER_SLOTS.map((s) => [s.key, s])
)

export function getSlot(key: string): BannerSlot | undefined {
  return slotsByKey.get(key)
}

export function isValidSlotKey(key: string): boolean {
  return slotsByKey.has(key)
}
