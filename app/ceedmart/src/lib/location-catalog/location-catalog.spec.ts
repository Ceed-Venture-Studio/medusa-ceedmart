import {
  isLocationPrice,
  planLocationPriceSync,
  resolveAvailability,
} from "./index"
import { normalizeProvince, provinceOfChannelMetadata } from "../locations"

describe("normalizeProvince", () => {
  it.each([
    ["ng-la", "ng-la"],
    ["NG-LA", "ng-la"],
    ["Lagos", "ng-la"],
    ["akwa ibom", "ng-ak"],
    ["Akwa-Ibom State", "ng-ak"],
    ["Rivers State", "ng-ri"],
    ["FCT", "ng-fc"],
    ["Abuja", "ng-fc"],
  ])("%s → %s", (input, code) => {
    expect(normalizeProvince(input)).toBe(code)
  })

  it.each([["Atlantis"], [""], [null], [42], ["ng-xx"]])(
    "%p → null",
    (input) => {
      expect(normalizeProvince(input)).toBeNull()
    }
  )
})

describe("provinceOfChannelMetadata", () => {
  const web = { lagos: "ng-la" }

  it("maps a web location channel through its configured province", () => {
    expect(
      provinceOfChannelMetadata({ ceedmart_web: { location: "lagos" } }, web)
    ).toBe("ng-la")
  })

  it("maps a POS shop by its state name", () => {
    expect(
      provinceOfChannelMetadata(
        { ceedmart: { code: "UYO", state: "Akwa Ibom" } },
        web
      )
    ).toBe("ng-ak")
  })

  it("is null for the default channel", () => {
    expect(provinceOfChannelMetadata(null, web)).toBeNull()
    expect(provinceOfChannelMetadata({}, web)).toBeNull()
  })
})

describe("resolveAvailability", () => {
  const targets = [
    { variantId: "v1", productId: "p1" },
    { variantId: "v2", productId: "p1" },
    { variantId: "v3", productId: "p2" },
  ]

  it("defaults to available with no rows", () => {
    const r = resolveAvailability(targets, [], "ng-la")
    expect([...r.values()]).toEqual([true, true, true])
  })

  it("applies a product row to every variant of the product", () => {
    const r = resolveAvailability(
      targets,
      [{ product_id: "p1", province: "ng-la", is_available: false }],
      "ng-la"
    )
    expect(r.get("v1")).toBe(false)
    expect(r.get("v2")).toBe(false)
    expect(r.get("v3")).toBe(true)
  })

  it("lets a variant row override its product row either way", () => {
    const r = resolveAvailability(
      targets,
      [
        { product_id: "p1", province: "ng-la", is_available: false },
        { variant_id: "v2", province: "ng-la", is_available: true },
        { variant_id: "v3", province: "ng-la", is_available: false },
      ],
      "ng-la"
    )
    expect(r.get("v1")).toBe(false)
    expect(r.get("v2")).toBe(true)
    expect(r.get("v3")).toBe(false)
  })

  it("ignores rows for other states", () => {
    const r = resolveAvailability(
      targets,
      [{ product_id: "p1", province: "ng-ri", is_available: false }],
      "ng-la"
    )
    expect(r.get("v1")).toBe(true)
  })
})

describe("planLocationPriceSync", () => {
  const regions = { ngn: ["reg_ng"] }
  const national = {
    id: "price_nat",
    amount: 50000,
    currency_code: "ngn",
    price_rules: [{ attribute: "region_id", value: "reg_ng" }],
  }
  const sale = {
    id: "price_sale",
    amount: 45000,
    currency_code: "ngn",
    price_list_id: "plist_1",
    price_rules: [{ attribute: "province", value: "ng-la" }],
  }
  const variant = (id: string, prices: any[] = [national]) => ({
    id,
    product_id: "p1",
    price_set_id: `pset_${id}`,
    prices,
  })

  it("creates a province price that also carries the region rule", () => {
    const plan = planLocationPriceSync(
      [variant("v1")],
      [{ product_id: "p1", province: "ng-la", currency_code: "NGN", amount: 55000 }],
      regions
    )
    expect(plan.remove).toEqual([])
    expect(plan.create).toEqual([
      {
        price_set_id: "pset_v1",
        currency_code: "ngn",
        amount: 55000,
        rules: { province: "ng-la", region_id: "reg_ng" },
      },
    ])
  })

  it("gives every variant the product price, including new ones", () => {
    const plan = planLocationPriceSync(
      [variant("v1"), variant("v_new")],
      [{ product_id: "p1", province: "ng-la", currency_code: "ngn", amount: 55000 }],
      regions
    )
    expect(plan.create.map((c) => c.price_set_id)).toEqual([
      "pset_v1",
      "pset_v_new",
    ])
  })

  it("prefers a variant's own price over the product's", () => {
    const plan = planLocationPriceSync(
      [variant("v1"), variant("v2")],
      [
        { product_id: "p1", province: "ng-la", currency_code: "ngn", amount: 55000 },
        { variant_id: "v2", province: "ng-la", currency_code: "ngn", amount: 70000 },
      ],
      regions
    )
    expect(plan.create.map((c) => [c.price_set_id, c.amount])).toEqual([
      ["pset_v1", 55000],
      ["pset_v2", 70000],
    ])
  })

  it("leaves an up-to-date location price alone", () => {
    const current = {
      id: "price_la",
      amount: 55000,
      currency_code: "ngn",
      price_rules: [
        { attribute: "province", value: "ng-la" },
        { attribute: "region_id", value: "reg_ng" },
      ],
    }
    const plan = planLocationPriceSync(
      [variant("v1", [national, current])],
      [{ product_id: "p1", province: "ng-la", currency_code: "ngn", amount: 55000 }],
      regions
    )
    expect(plan).toEqual({ create: [], remove: [] })
  })

  it("replaces a stale amount and removes prices with no authoring row", () => {
    const stale = {
      id: "price_la",
      amount: 50000,
      currency_code: "ngn",
      price_rules: [
        { attribute: "province", value: "ng-la" },
        { attribute: "region_id", value: "reg_ng" },
      ],
    }
    const orphan = {
      id: "price_ri",
      amount: 52000,
      currency_code: "ngn",
      price_rules: [
        { attribute: "province", value: "ng-ri" },
        { attribute: "region_id", value: "reg_ng" },
      ],
    }
    const plan = planLocationPriceSync(
      [variant("v1", [national, stale, orphan])],
      [{ product_id: "p1", province: "ng-la", currency_code: "ngn", amount: 55000 }],
      regions
    )
    expect(plan.remove.sort()).toEqual(["price_la", "price_ri"])
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0].amount).toBe(55000)
  })

  it("never touches national or price-list prices", () => {
    expect(isLocationPrice(national)).toBe(false)
    expect(isLocationPrice(sale)).toBe(false)
    const plan = planLocationPriceSync([variant("v1", [national, sale])], [], regions)
    expect(plan).toEqual({ create: [], remove: [] })
  })

  it("falls back to a province-only rule when no region uses the currency", () => {
    const plan = planLocationPriceSync(
      [variant("v1")],
      [{ product_id: "p1", province: "ng-la", currency_code: "usd", amount: 40 }],
      regions
    )
    expect(plan.create[0].rules).toEqual({ province: "ng-la" })
  })
})
