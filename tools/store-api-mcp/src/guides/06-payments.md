# Payments

Ceedmart takes online payment through **Pulse Pay**, a hosted payment page
(card, transfer and other methods Pulse offers). The shopper pays on Pulse's
page; the backend confirms with Pulse before placing the order.

## Requirements

- **A signed-in customer.** Guests cannot pay online. If the cart was started
  as a guest, attach it first: `POST /store/carts/{id}/customer` with the
  customer token.
- **The customer must have a Pulse account.** It is created at registration
  (see `auth`). If that failed, payment options say `no_pulse_identity`.

## Flow

1. **What can the shopper use?** `GET /store/payment-options?cart_id={id}`
   with the customer token. The response is `{ "options": [...], "reason": null }`,
   or `options: []` with a reason:

   | `reason` | Meaning | Show |
   |---|---|---|
   | `not_signed_in` | Guest | Ask them to sign in |
   | `no_pulse_identity` | Customer has no Pulse account | "Online payment is unavailable for this account", and contact support |
   | `none_configured` | Pulse has no methods set up | "Online payment is unavailable" |
   | `unavailable` (HTTP 502) | Pulse unreachable | Retry later |

   Response keys here are camelCase (e.g. `displayName`).

2. **Start the payment.** Create a payment collection, then a Pulse session:
   - `POST /store/payment-collections` with `{ "cart_id" }`, which returns `payment_collection.id`
   - `POST /store/payment-collections/{id}/payment-sessions` with
     `{ "provider_id": "pp_pulse-pay_pulse-pay" }`

   The session's `data.checkout_url` is the Pulse payment page.

   **Creating a session deletes the cart's existing one.** If the shopper
   comes back to pay again, check `payment-status` first (step 4); if a session
   exists and its status is `unknown`, reuse its `checkout_url` instead of
   creating a new session.

3. **Open `checkout_url` in an in-app browser** (Custom Tabs, or
   SFSafariViewController / ASWebAuthenticationSession). When payment ends,
   Pulse redirects to the **website** (`…/ng/checkout?step=review`), not to
   the app, and the return address cannot be an app link today. Treat the
   browser closing, or a load of that website URL, as "payment finished",
   then confirm with step 4.

4. **Confirm.** Poll `GET /store/carts/{id}/payment-status` every 2–3 seconds
   for up to about a minute:

   ```json
   { "paid": true, "reason": null, "session_status": "authorized", "pulse_status": … }
   ```

   | Response | Meaning |
   |---|---|
   | `paid: true` | Paid. Go to complete. |
   | `paid: false`, `reason: null` | Not paid yet, or abandoned. |
   | `reason: "no_session"` | No payment started on this cart. |
   | `reason: "not_a_pulse_session"` | The cart's session is not Pulse (e.g. a manual method). |
   | `reason: "unknown"` | Pulse could not be reached. It is **not** "unpaid"; keep polling, and never start a new session because of it. |

5. **Complete the cart** (`cart-and-checkout`, step 6). Check `completed_at`
   first: Pulse's webhook may already have placed the order.

## Staging

Pulse is not connected on staging, so `payment-options` returns no options and
Pulse sessions fail. To test the rest of checkout on staging, use the manual
bank-transfer provider:

```json
POST /store/payment-collections/{id}/payment-sessions
{ "provider_id": "pp_bank-transfer_manual" }
```

then complete the cart. The order is placed unpaid, as a bank transfer would
be.

The manual providers (`pp_cash_manual`, `pp_card_manual`,
`pp_bank-transfer_manual`, `pp_online_manual`, `pp_other_manual`) exist for
the shop tills. On production the website offers only Pulse Pay; the app
should do the same unless Ceedmart decides otherwise.

`GET /store/payment-providers?region_id=…` lists every registered provider,
including the till-only ones, so do not build the payment screen from it.
