# Working on staging

Staging is a full copy of the Ceedmart backend, for building and testing the
app.

- **URL:** `https://ceedmart-api-staging-870514614467.europe-west1.run.app`
- **Publishable key:** returned by `get_environment` ("Mobile app (staging)").

## What is different from production

- **Data is anonymised.** The catalog, prices, categories and shops are real.
  Customers and past orders are fake (`u…@staging.ceedmart.test`, phones
  starting `+234000`). No production login works.
- **No real payments.** Pulse Pay is not connected, so online payment is
  unavailable (`GET /store/payment-options` returns no options). Place test
  orders with `pp_bank-transfer_manual`; see `payments`.
- **No email or SMS** is sent: no order confirmations, OTPs or password-reset
  emails. Password reset cannot be completed on staging.
- **It sleeps when idle.** The first request after a quiet spell can take 1–3
  minutes. Retry rather than treating it as an outage.
- **Some prices are demo data.** Palm Oil has a Lagos-only price on the
  25-litre and the 4-litre is marked unavailable in Lagos, to show location
  pricing.

## Test accounts

Create your own; registration works on staging. Use any address ending
`@staging.ceedmart.test` and a phone starting `+234000` so test data is easy
to tell apart. See `auth`.

## Anything else

Ask the Ceedmart team for an admin login if you need to change products,
prices or stock on staging.
