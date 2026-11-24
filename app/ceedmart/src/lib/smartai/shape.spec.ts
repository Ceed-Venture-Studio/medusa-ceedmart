import {
  CatalogProduct,
  CatalogVariant,
  CartLine,
  filterAndSort,
  linesFor,
  matchCategoryIds,
  matchVariant,
  plainText,
  purchasable,
  refusal,
  hasWord,
  preferTitleMatches,
  relevance,
  searchWords,
  sizeLabel,
  toSmartaiCart,
  toSmartaiProduct,
} from "./shape"

const variant = (over: Partial<CatalogVariant> = {}): CatalogVariant => ({
  id: "variant_1",
  manage_inventory: true,
  allow_backorder: false,
  option_values: ["1 Piece"],
  price: 700,
  stock: 10,
  available_here: true,
  commerce_type: "standard",
  policy_active: true,
  ...over,
})

const product = (variants: CatalogVariant[], over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "prod_1",
  title: "Clappa Tomato Paste",
  handle: "clappa-tomato-paste",
  thumbnail: "https://img/1.jpg",
  description: "<p>Rich <b>tomato</b> paste &amp; more</p>",
  category: "Cans & Paste",
  variants,
  ...over,
})

describe("sizes", () => {
  it("labels by option values and drops Medusa's default option", () => {
    expect(sizeLabel({ option_values: ["1 Carton(20 Pieces)"] })).toBe("1 Carton(20 Pieces)")
    expect(sizeLabel({ option_values: ["Black", "128GB"] })).toBe("Black / 128GB")
    expect(sizeLabel({ option_values: ["Default option"] })).toBe("")
  })

  it("matches exactly, then loosely, never fuzzily", () => {
    const p = product([
      variant({ id: "v_piece", option_values: ["1 Piece"] }),
      variant({ id: "v_carton", option_values: ["1 Carton(20 Pieces)"] }),
    ])
    expect(matchVariant(p, "1 Carton(20 Pieces)")).toEqual({ variant: p.variants[1] })
    expect(matchVariant(p, "1 carton ( 20 pieces )")).toEqual({ variant: p.variants[1] })
    expect((matchVariant(p, "carton") as any).error.code).toBe("bad_size")
    expect((matchVariant(p, undefined) as any).error.message).toContain("1 Piece, 1 Carton(20 Pieces)")
  })

  it("ignores size for a single-variant product", () => {
    const p = product([variant({ option_values: ["Default option"] })])
    expect(matchVariant(p, "anything")).toEqual({ variant: p.variants[0] })
  })
})

describe("purchasable / refusal", () => {
  it("uses the storefront stock rule", () => {
    expect(purchasable(variant({ stock: 0 }))).toBe(false)
    expect(purchasable(variant({ stock: 0, allow_backorder: true }))).toBe(true)
    expect(purchasable(variant({ stock: null, manage_inventory: false }))).toBe(true)
  })

  it("leaves out pre-orders, auctions, unpriced and not-here variants", () => {
    expect(purchasable(variant({ commerce_type: "preorder" }))).toBe(false)
    expect(purchasable(variant({ policy_active: false }))).toBe(false)
    expect(purchasable(variant({ available_here: false }))).toBe(false)
    expect(purchasable(variant({ price: null }))).toBe(false)
  })

  it("explains each refusal for a shopper", () => {
    const p = product([variant()])
    expect(refusal(p, variant({ commerce_type: "auction" }), 1, "Rivers")?.code).toBe("not_purchasable")
    expect(refusal(p, variant({ available_here: false }), 1, "Rivers")?.message).toBe(
      "Clappa Tomato Paste is not available in Rivers."
    )
    expect(refusal(p, variant({ stock: 0 }), 1, "Rivers")?.code).toBe("out_of_stock")
    const short = refusal(p, variant({ stock: 3 }), 5, "Rivers")
    expect(short).toEqual({ code: "insufficient_stock", message: "Only 3 of Clappa Tomato Paste are available in Rivers." })
    expect(refusal(p, variant({ stock: 5 }), 5, "Rivers")).toBeNull()
  })
})

describe("toSmartaiProduct", () => {
  it("prices at the cheapest purchasable variant and lists only those sizes", () => {
    const p = product([
      variant({ id: "a", option_values: ["1 Can"], price: 700 }),
      variant({ id: "b", option_values: ["6 Cans"], price: 4000 }),
      variant({ id: "c", option_values: ["1 Carton"], price: 300, stock: 0 }),
    ])
    expect(toSmartaiProduct(p, "https://ceedmart.com")).toEqual({
      product_id: "prod_1",
      name: "Clappa Tomato Paste",
      price: 700,
      currency: "NGN",
      category: "Cans & Paste",
      image_url: "https://img/1.jpg",
      available_sizes: ["1 Can", "6 Cans"],
      in_stock: true,
      product_url: "https://ceedmart.com/ng/products/clappa-tomato-paste",
      description: "Rich tomato paste & more",
    })
  })

  it("gives single-variant products no sizes, and drops products with nothing to buy", () => {
    expect(toSmartaiProduct(product([variant({ option_values: ["Default option"] })]), null)?.available_sizes).toEqual([])
    expect(toSmartaiProduct(product([variant({ stock: 0 })]), null)).toBeNull()
  })

  it("trims descriptions to 500 characters at a word", () => {
    const long = plainText("word ".repeat(200))!
    expect(long.length).toBeLessThanOrEqual(500)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("search helpers", () => {
  it("keeps meaningful words only", () => {
    expect(searchWords("a 5 kVA inverter for the shop")).toEqual(["kva", "inverter", "shop"])
    expect(searchWords("50kg rice")).toEqual(["50kg", "rice"])
  })

  it("drops filler and prices from a shopper's sentence", () => {
    expect(searchWords("I need rice for a party, under ₦100,000")).toEqual(["rice"])
    expect(searchWords("show me cheap basmati rice below 20000 naira")).toEqual(["basmati", "rice"])
    expect(searchWords("2.5kva inverter")).toEqual(["2.5kva", "inverter"])
  })

  it("matches whole words and plurals, not fragments", () => {
    expect(hasWord("Honey Beans (Oloyin)", "bean")).toBe(true)
    expect(hasWord("Best price guaranteed", "rice")).toBe(false)
    expect(hasWord("Mama Gold Rice", "rice")).toBe(true)
    expect(hasWord("Aurora 2.5kVA Inverter", "2.5kva")).toBe(true)
  })

  it("keeps only title matches when there are any", () => {
    const items = [
      { title: "Mango Rice", description: "" },
      { title: "Fresh Tomato Basket", description: "Perfect for jollof rice" },
      { title: "Titus Sardines", description: "Serve with rice" },
    ]
    expect(preferTitleMatches(items, (x) => x.title, ["rice"]).map((x) => x.title)).toEqual(["Mango Rice"])
    // Nothing in a title: description matches are still better than nothing.
    expect(preferTitleMatches(items, (x) => x.title, ["jollof"]).length).toBe(3)
    expect(preferTitleMatches(items, (x) => x.title, []).length).toBe(3)
  })

  it("ranks title matches above description matches", () => {
    const t = relevance({ title: "Aurora 5kVA Inverter", description: "" }, ["inverter"], "inverter")
    const d = relevance({ title: "Battery", description: "for any inverter" }, ["inverter"], "inverter")
    expect(t).toBeGreaterThan(d)
  })

  it("filters on the shopper's price and sorts", () => {
    const ps = [
      { product_id: "a", price: 500 },
      { product_id: "b", price: 100 },
      { product_id: "c", price: 300 },
    ] as any
    expect(filterAndSort(ps, { min_price: 200 }).map((p) => p.product_id)).toEqual(["a", "c"])
    expect(filterAndSort(ps, { sort_by: "price_asc" }).map((p) => p.product_id)).toEqual(["b", "c", "a"])
    expect(
      filterAndSort(ps, { sort_by: "popular", popularity: new Map([["c", 9], ["a", 2]]) }).map((p) => p.product_id)
    ).toEqual(["c", "a", "b"])
    expect(filterAndSort(ps, { sort_by: "popular" }).map((p) => p.product_id)).toEqual(["a", "b", "c"])
  })
})

describe("matchCategoryIds", () => {
  const cats = [
    { id: "solar", name: "Solar Energy", mpath: "solar." },
    { id: "panels", name: "Solar Panels", mpath: "solar.panels." },
    { id: "wf", name: "Whole Foods", mpath: "wf." },
    { id: "soups", name: "Soups & Spices", mpath: "wf.soups." },
  ]
  it("matches names loosely and includes descendants", () => {
    expect(matchCategoryIds(cats, "Solar Energy").sort()).toEqual(["panels", "solar"])
    expect(matchCategoryIds(cats, "soups and spices")).toEqual(["soups"])
    expect(matchCategoryIds(cats, "spices")).toEqual(["soups"])
    expect(matchCategoryIds(cats, "gardening")).toEqual([])
  })
})

describe("cart", () => {
  const line = (over: Partial<CartLine> = {}): CartLine => ({
    id: "li_1",
    product_id: "prod_1",
    variant_id: "v1",
    product_title: "Rice",
    title: "Rice 50kg",
    thumbnail: null,
    quantity: 2,
    unit_price: 55000,
    subtotal: 110000,
    option_values: ["50kg"],
    multi_variant: true,
    ...over,
  })

  it("shapes the cart and only links checkout when it has items", () => {
    const cart = toSmartaiCart([line()], 110000, "https://x/continue")
    expect(cart).toEqual({
      item_count: 2,
      subtotal: 110000,
      currency: "NGN",
      items: [{ product_id: "prod_1", name: "Rice", size: "50kg", quantity: 2, unit_price: 55000, line_total: 110000 }],
      checkout_url: "https://x/continue",
    })
    expect(toSmartaiCart([], 0, "https://x/continue").checkout_url).toBeUndefined()
  })

  it("asks which size when the product is in the cart twice", () => {
    const lines = [line(), line({ id: "li_2", option_values: ["25kg"] })]
    expect((linesFor(lines, "prod_1", null) as any).error.code).toBe("size_required")
    expect((linesFor(lines, "prod_1", "25KG") as any).lines[0].id).toBe("li_2")
    expect((linesFor(lines, "prod_9", null) as any).error.code).toBe("not_in_cart")
  })
})

describe("num", () => {
  // Medusa returns totals in-process as BigNumber objects, not numbers.
  const { num } = require("./shape")
  const { BigNumber } = require("@medusajs/framework/utils")
  it("reads numbers, numeric strings and BigNumbers", () => {
    expect(num(158000)).toBe(158000)
    expect(num("79000")).toBe(79000)
    expect(num(new BigNumber(158000))).toBe(158000)
    expect(num({ value: "5" })).toBe(5)
    expect(num(null)).toBe(0)
  })
})
