# Orders

## The customer's orders

Signed in (customer token):

- `GET /store/orders` lists them, newest first. Paginate with `limit` and `offset`.
- `GET /store/orders/{id}` returns one order.

Useful fields: `display_id` (the number to show), `status`, `payment_status`,
`fulfillment_status`, `items`, `total`, `created_at`, and
`metadata.ceedmart.fulfillment` (`"delivery"` or `"pickup"`).

## Tracking without signing in

`GET /store/orders/track` looks up an order for a guest. Use `get_endpoint`
with id `orders-track` for its exact parameters.

## Notes

- Amounts are naira in whole units, like the rest of the API.
- An order placed by the Pulse webhook appears here like any other; the app
  does not need to have called complete itself.
- Treat order ids as private. Do not put them in shareable links.
