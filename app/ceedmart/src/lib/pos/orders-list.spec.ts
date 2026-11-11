import knexFactory from "knex"
import { inIdOrder, ordersWithStatus, toPosOrderRow } from "./orders-list"

const knex = knexFactory({ client: "pg" })
const sql = (filters: Parameters<typeof ordersWithStatus>[1]) =>
  ordersWithStatus(knex, filters).toString()

describe("ordersWithStatus", () => {
  it("lists placed orders only", () => {
    const text = sql({})
    expect(text).toContain(`"o"."deleted_at" is null`)
    expect(text).toContain(`"o"."is_draft_order" = false`)
  })

  it("narrows to a sales channel", () => {
    expect(sql({ sales_channel_id: "sc_uyo" })).toContain(
      `"o"."sales_channel_id" = 'sc_uyo'`
    )
  })

  it("searches by order number as well as email", () => {
    const text = sql({ q: "#1042" })
    expect(text).toContain(`"o"."display_id" = 1042`)
    expect(text).toContain(`"o"."email" ilike '%1042%'`)
  })

  it("searches by email alone for text", () => {
    const text = sql({ q: "ada@" })
    expect(text).toContain(`"o"."email" ilike '%ada@%'`)
    expect(text).not.toContain(`"o"."display_id" =`)
  })

  it("treats LIKE wildcards in the search as literal text", () => {
    expect(sql({ q: "50%_off" })).toContain(`E'%50\\\\%\\\\_off%'`)
  })
})

describe("toPosOrderRow", () => {
  it("keeps only what the table shows", () => {
    const row = toPosOrderRow({
      id: "order_1",
      display_id: 7,
      created_at: "2026-11-11T07:00:00Z",
      status: "pending",
      payment_status: "captured",
      fulfillment_status: "not_fulfilled",
      total: "51000",
      currency_code: "ngn",
      email: "guest@example.com",
      customer: null,
      sales_channel: { id: "sc_1", name: "Uyo", ...{ description: "x" } },
      shipping_methods: [{ name: "Office Pickup", shipping_option_id: "so_1" }],
      ...{ items: [{ id: "item_1" }] },
    } as any)

    expect(row).toEqual({
      id: "order_1",
      display_id: 7,
      custom_display_id: null,
      created_at: "2026-11-11T07:00:00Z",
      status: "pending",
      payment_status: "captured",
      fulfillment_status: "not_fulfilled",
      total: 51000,
      currency_code: "ngn",
      customer: { email: "guest@example.com" },
      sales_channel: { id: "sc_1", name: "Uyo" },
      shipping_methods: [{ name: "Office Pickup", shipping_option_id: "so_1" }],
    })
  })
})

describe("inIdOrder", () => {
  it("restores the page order and skips ids that came back missing", () => {
    expect(
      inIdOrder(["b", "a", "c"], [{ id: "a" }, { id: "b" }]).map((r) => r.id)
    ).toEqual(["b", "a"])
  })
})
