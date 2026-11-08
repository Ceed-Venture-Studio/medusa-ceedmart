# Errors

Errors are JSON with an HTTP status:

```json
{ "type": "not_allowed", "message": "Palm Oil — Palm Oil- 4liters: This item is not available in Lagos." }
```

| Status | `type` | Typical cause | What the app should do |
|---|---|---|---|
| 400 | `invalid_data` | Missing or wrong field, e.g. `Invalid request: Field 'phone' is required` | Show the message on the form; fix the request in development. |
| 400 | `not_allowed` | A business rule: item not sold in this city, auction item in the cart | Show `message` as written; it is written for shoppers. |
| 401 | `unauthorized` | Missing or expired customer token | Refresh the token (`POST /auth/token/refresh`) or sign in again. |
| 404 | `not_found` | Unknown id, or a product not in the requested channel | Refresh the data; the item may have been removed. |
| 409 | `conflict` | Two requests changed the same cart at once | Re-fetch the cart and retry once. |
| 422 | `duplicate_error` | Registering an email that already has an account | Offer sign-in instead. |
| 422 | `payment_authorization_error` | Payment not confirmed when completing the cart | Keep the cart; let the shopper retry payment. |
| 500 | `unknown_error`, `database_error` | Server error | Retry with backoff. Report it if it persists. |

Messages for `not_allowed` are safe to show shoppers verbatim. Treat other
messages as developer-facing.

A cart that holds an item no longer sold in the shopper's city is refused at
checkout with a `not_allowed` message naming the item. The cart response marks
such lines `available_here: false` beforehand, so flag them before the
shopper reaches checkout.
