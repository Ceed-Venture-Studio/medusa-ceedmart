import ceedmartNotifications from "./ceedmart-notifications"

// The shop's order alert: who hears about an order, and what they read.

const paidOrder = (overrides: Record<string, any> = {}) => ({
  id: "order_01TEST",
  display_id: 1043,
  email: "ada.okafor@example.com",
  created_at: "2026-10-25T09:42:00.000Z",
  currency_code: "ngn",
  summary: { current_order_total: 45500 },
  shipping_address: {
    first_name: "Ada",
    last_name: "Okafor",
    address_1: "14 Peter Odili Road",
    city: "Port Harcourt",
    province: "Rivers",
    phone: "08031234567",
  },
  items: [
    {
      product_title: "Ayoola Beans Flour",
      variant_title: "1kg",
      unit_price: 3500,
      detail: { quantity: 2 },
    },
    {
      product_title: "Mama Gold Rice",
      variant_title: "50kg",
      unit_price: 38500,
      detail: { quantity: 1 },
    },
  ],
  shipping_methods: [{ name: "Home Delivery (You will be contacted)" }],
  payment_collections: [
    {
      status: "authorized",
      payments: [{ provider_id: "pp_pulse-pay_pulse-pay" }],
    },
  ],
  metadata: { ceedmart: { channel: "online", fulfillment: "delivery" } },
  ...overrides,
})

const run = async (order: any) => {
  const sends: any[] = []
  const container: any = {
    resolve: (key: string) => {
      if (key === "logger") {
        return {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        }
      }
      if (key === "query") {
        return { graph: async () => ({ data: [order] }) }
      }
      if (key === "notification") {
        return { createNotifications: async (n: any) => sends.push(n) }
      }
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  await ceedmartNotifications({
    event: { name: "order.placed", data: { id: order.id } },
    container,
  } as any)
  return sends.filter((s) => s.template.startsWith("order-placed-admin"))
}

// GSM 03.38 basic set plus the extension table (counted once here; none of
// those characters appear in the alert). Anything else forces UCS-2.
const GSM7 =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/

describe("shop order alert", () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    process.env.ORDER_ALERT_EMAIL = "ops@example.com, owner@example.com"
    process.env.ORDER_ALERT_PHONE = "+2349030000001,+2347080000002"
  })
  afterAll(() => {
    process.env = OLD
  })

  it("emails and texts every listed recipient for a paid online order", async () => {
    const sends = await run(paidOrder())
    const emails = sends.filter((s) => s.channel === "email").map((s) => s.to)
    const sms = sends.filter((s) => s.channel === "sms").map((s) => s.to)
    expect(emails).toEqual(["ops@example.com", "owner@example.com"])
    expect(sms).toEqual(["+2349030000001", "+2347080000002"])
  })

  it("stays silent for an unpaid order", async () => {
    const unpaid = paidOrder({
      payment_collections: [{ status: "awaiting", payments: [] }],
    })
    expect(await run(unpaid)).toEqual([])
  })

  it("stays silent for an order the manual provider 'authorized'", async () => {
    const manual = paidOrder({
      payment_collections: [
        {
          status: "authorized",
          payments: [{ provider_id: "pp_system_default" }],
        },
      ],
    })
    expect(await run(manual)).toEqual([])
  })

  it("stays silent for a till sale", async () => {
    const till = paidOrder({ metadata: { ceedmart: { channel: "in-store" } } })
    expect(await run(till)).toEqual([])
  })

  it("texts one GSM-7 message without the customer's phone", async () => {
    const [sms] = (await run(paidOrder())).filter((s) => s.channel === "sms")
    const text: string = sms.content.text
    expect(text).toBe(
      "Ceedmart NEW ORDER #1043: 3 items, NGN 45,500, PAID. Delivery to Port Harcourt. Ada Okafor. Full details sent to email."
    )
    expect(text.length).toBeLessThanOrEqual(160)
    expect(text).toMatch(GSM7)
    expect(text).not.toContain("0803")
  })

  it("says Pickup for a pickup order", async () => {
    const pickup = paidOrder({
      metadata: { ceedmart: { channel: "online", fulfillment: "pickup" } },
      shipping_methods: [
        { name: "Office Pickup (Ceedmart Eliozu, Port Harcourt)" },
      ],
    })
    const sends = await run(pickup)
    const sms = sends.find((s) => s.channel === "sms")!.content.text
    const email = sends.find((s) => s.channel === "email")!
    expect(sms).toContain("PAID. Pickup.")
    expect(email.content.subject).toBe("New order #1043 · NGN 45,500 · Pickup")
    expect(email.content.text).toContain(
      "Pickup: Office Pickup (Ceedmart Eliozu, Port Harcourt)"
    )
    expect(email.content.text).not.toContain("Delivery fee")
  })

  it("emails everything needed to start picking", async () => {
    const email = (await run(paidOrder())).find((s) => s.channel === "email")!
    expect(email.content.subject).toBe(
      "New order #1043 · NGN 45,500 · Delivery, Port Harcourt"
    )
    expect(email.content.text).toMatchInlineSnapshot(`
      "NEW ONLINE ORDER #1043
      Placed 25 Oct 2026, 10:42 am

      CUSTOMER
        Ada Okafor
        Phone: 08031234567
        Email: ada.okafor@example.com

      FULFILMENT
        Deliver to: 14 Peter Odili Road, Port Harcourt, Rivers
        Delivery fee: to be agreed with the customer

      PAYMENT
        PAID online

      ITEMS
        2 x Ayoola Beans Flour (1kg): NGN 3,500 each = NGN 7,000
        1 x Mama Gold Rice (50kg): NGN 38,500 each = NGN 38,500

        Subtotal: NGN 45,500
        TOTAL: NGN 45,500

      NEXT STEPS
        Open in admin: https://admin-core.ceedmart.com/app/orders/order_01TEST
        WhatsApp the customer: https://wa.me/2348031234567

      Ceedmart order alerts"
    `)
  })
})
