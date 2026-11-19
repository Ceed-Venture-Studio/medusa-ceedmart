// Canonical banner slots. Each slot corresponds to a specific placement on
// the storefront and enforces strict image dimensions on upload. Adding a
// slot here is a code change that should pair with the storefront component
// that renders it — keeps banner data and storefront layout in sync.

export type ImageSpec = {
  aspect_ratio: number     // width / height
  min_width: number        // px
  min_height: number       // px
}

export type BannerSlot = ImageSpec & {
  key: string
  label: string
  description: string
  /**
   * A second image for phones. When set, the slot takes a desktop image
   * (the main spec) and a mobile image with this spec on the same banner.
   */
  mobile?: ImageSpec
  /**
   * Which text fields the storefront renders over this slot:
   *   hero     — badge, headline, highlighted line, paragraph, two buttons
   *   carousel — headline, subheadline, two buttons
   *   none     — image only; the link makes the whole image clickable
   */
  overlay: "hero" | "carousel" | "none"
}

export const BANNER_SLOTS: BannerSlot[] = [
  {
    key: "home_hero",
    label: "Home Hero (carousel)",
    aspect_ratio: 21 / 9,
    min_width: 1920,
    min_height: 823,
    mobile: { aspect_ratio: 4 / 5, min_width: 800, min_height: 1000 },
    overlay: "hero",
    description:
      "Rotating hero at the top of the home page. Each slide takes a desktop " +
      "image (21:9) and a mobile image (4:5), with its own badge, headline, " +
      "highlighted line, paragraph and two buttons. Leave any text blank to " +
      "hide it. With no active slide the home page shows the built-in hero.",
  },
  {
    key: "home_secondary",
    label: "Home Secondary",
    aspect_ratio: 1,
    min_width: 600,
    min_height: 600,
    overlay: "none",
    description: "Home page secondary slot — typically 3-up square row.",
  },
  {
    key: "category_banner",
    label: "Category Page Banner",
    aspect_ratio: 4,
    min_width: 1200,
    min_height: 300,
    overlay: "none",
    description: "Top of a category page. Wide banner with text overlay.",
  },
  {
    key: "promo_strip",
    label: "Promo Strip",
    aspect_ratio: 32 / 3,
    min_width: 1920,
    min_height: 180,
    overlay: "none",
    description: "Site-wide announcement bar. Ultra-thin and ultra-wide.",
  },
  {
    key: "product_sidebar",
    label: "Product Page Sidebar",
    aspect_ratio: 3 / 4,
    min_width: 600,
    min_height: 800,
    overlay: "none",
    description: "Sidebar of the product detail page. Portrait orientation.",
  },
  {
    key: "category_carousel",
    label: "Category Promo Carousel",
    aspect_ratio: 4,
    min_width: 1200,
    min_height: 300,
    overlay: "carousel",
    description:
      "Site-wide promotional carousel shown above content on all pages except home. Rotates through active banners; supports headline, subheadline, up to two CTAs, and custom colors.",
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
