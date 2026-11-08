# Cart and checkout

Order of calls, as the website does it and as verified on staging:

1. Create the cart (`POST /store/carts`)
2. Add items (`POST /store/carts/{id}/line-items`)
3. Set email and address (`POST /store/carts/{id}`)
4. Choose delivery or pickup (`GET /store/shipping-options`, then `POST /store/carts/{id}/shipping-methods`)
5. Pay (`payments` guide)
6. Complete (`POST /store/carts/{id}/complete`), which returns the order

Every call sends the publishable key, and the customer token when signed in.

## 1. Create the cart

```json
POST /store/carts
{
  "region_id": "<Nigeria region id>",
  "sales_channel_id": "<default_sales_channel_id from /store/web-locations>",
  "metadata": { "ceedmart": { "province": "ng-la" } }
}
```

- **`sales_channel_id` is required.** The publishable key covers several
  channels, so Medusa refuses a cart without one. Use the **default** channel
  for every cart, whatever city was chosen. City channels are for listings only.
- **`metadata.ceedmart.province`** is the chosen city's state, from
  `/store/web-locations`. The backend prices the cart for that state and
  checks what may be bought there.
- Create the cart empty, then add items. A cart created with items is priced
  correctly too, but the empty-then-add order is the tested path.

Keep the cart id on the device and reuse it until the order is placed.

## 2. Add, change and remove items

- Add: `POST /store/carts/{id}/line-items` with `{ "variant_id", "quantity" }`.
  Unit prices come from the server; never send prices.
- Change quantity: `POST /store/carts/{id}/line-items/{line_id}` with `{ "quantity" }`.
- Remove: `DELETE /store/carts/{id}/line-items/{line_id}`. The response puts
  the cart under `parent`, not `cart`, so it lacks the location fields.
  Re-fetch the cart if you need them.

An item not sold in the cart's state is refused with
`400 not_allowed "<product> — <variant>: This item is not available in Lagos."`
Show that message as it is.

## 3. When the shopper changes city

Send the new state. **`metadata.ceedmart` is replaced, not merged**: send the
whole `ceedmart` object with your change, or you erase what other steps wrote
there (fulfilment choice, partner code).

```json
POST /store/carts/{id}
{ "metadata": { "ceedmart": { ...currentCart.metadata.ceedmart, "province": "ng-ri" } } }
```

The backend re-prices every line for the new state. Lines are never removed
automatically. A line that cannot be bought in the new state comes back with
`available_here: false`, and the cart carries `location: { province, name }`.
Show those lines as "Not available in <city>, remove to continue". Checkout is
refused until they are removed.

## 4. Email, address and delivery or pickup

Set the email (required for guests) and the shipping address:

```json
POST /store/carts/{id}
{
  "email": "ada@example.com",
  "shipping_address": {
    "first_name": "Ada", "last_name": "Obi",
    "address_1": "12 Aka Road", "city": "Uyo", "province": "Akwa Ibom",
    "country_code": "ng", "phone": "+2348012345678"
  }
}
```

List the ways to get the order: `GET /store/shipping-options?cart_id={id}`.
Options whose fulfilment set type is `pickup` are collection from a shop; the
rest are delivery. Choose one with
`POST /store/carts/{id}/shipping-methods` and `{ "option_id" }`.

Then record the choice in `metadata.ceedmart`, sending the whole object as
above. The website sends:

| Choice | `metadata.ceedmart` fields |
|---|---|
| Delivery | `channel: "online"`, `fulfillment: "delivery"`, `sourcing: "local"`, and `store_id` removed |
| Pickup | `channel: "online"`, `fulfillment: "pickup"`, `sourcing: "local"`, `store_id: "<shop sales channel id>"` |

The backend does not enforce these, but staff reports and order routing read
them, so the app should send exactly this. `channel` is always `"online"` for
app orders.

## 5. Pay

See `payments`. You end up with a payment session on the cart.

## 6. Complete

`POST /store/carts/{id}/complete` returns
`{ "type": "order", "order": { … } }` on success. Clear the stored cart id.

- If the response is `{ "type": "cart", "error": … }`, the order was not
  placed. Show the error and keep the cart.
- **Check `completed_at` first with Pulse Pay.** Pulse's webhook can place the
  order on its own. If `GET /store/carts/{id}` shows `completed_at` set, the
  order exists; treat a complete call that says "already completed" as success.
- Checkout is refused while any line is unavailable in the cart's state (see 3).

## Promotion codes

Add: `POST /store/carts/{id}/promotions` with `{ "promo_codes": ["CODE"] }`.
Remove: `DELETE /store/carts/{id}/promotions` with the same body. Codes match
exactly; trim spaces before sending. An unknown code returns an error whose
message says the code is invalid.

## Guest carts and signing in

A cart started as a guest can be attached to the customer after sign-in:
`POST /store/carts/{id}/customer` with the customer token. Do this before
paying with Pulse, which needs a signed-in customer.
