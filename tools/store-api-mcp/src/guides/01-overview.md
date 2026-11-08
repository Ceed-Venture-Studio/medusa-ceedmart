# Ceedmart store API — overview

Ceedmart is a Nigerian wholesale and bulk-supply store (foods, groceries,
solar, power, CCTV, computer accessories). The backend is **Medusa v2** with
Ceedmart extensions; the website (ceedmart.com) and the in-store PoS tills use
the same backend the mobile app will.

## Environments

| | Base URL | Use |
|---|---|---|
| **Staging** | `https://ceedmart-api-staging-870514614467.europe-west1.run.app` | Build and test here. Anonymised data, no real payments, no email/SMS. |
| Production | provided at release | The live shop. Do not test against it. |

`get_environment` returns the base URL, the publishable key and the live
location map for whichever backend this MCP server points at.

## Every request

- Send the publishable key on every `/store/*` request:
  `x-publishable-api-key: pk_…`. It is public by design and ships in the app.
- Customer-specific requests also send `Authorization: Bearer <customer JWT>`
  (see the `auth` guide).
- JSON in, JSON out. Errors come back as `{ "type": "...", "message": "..." }`
  (see `errors`).
- Money amounts are in **naira as whole units** (`55000` is ₦55,000), currency
  code `ngn`. There is one region, Nigeria.

## Things that are specific to Ceedmart

These are where a stock Medusa client goes wrong; each has its own guide.

1. **Locations decide price and availability.** The shopper picks a city
   (Port Harcourt, Uyo, Lagos). Each city has its own sales channel for
   listings, and prices and availability can differ by state. → `catalog-and-locations`
2. **Carts need a `sales_channel_id`** and carry the chosen state in
   `metadata.ceedmart.province`. → `cart-and-checkout`
3. **`metadata.ceedmart` is shared.** Several features write keys into it.
   Always merge into the existing object; never replace it. → `cart-and-checkout`
4. **Registration needs a phone number and password** on the customer record,
   not only on the auth identity. → `auth`
5. **Payments** are Pulse Pay (card/transfer through a hosted page) or manual
   methods. → `payments`

## Guides

`overview`, `quickstart`, `auth`, `catalog-and-locations`,
`cart-and-checkout`, `payments`, `orders`, `errors`, `staging`.
