# Ceedmart — Phase 2 Capability Scope

**Status:** Draft for review
**Meta-goal:** Stand up a second physical shop, standardize how orders flow
through the platform end-to-end, and add customer, partner, and operational
capabilities the business now needs to keep growing.

Every capability below has to work identically at Store 1 and Store 2 so the
same operating playbook applies at every future location.

---

## 1. Multi-location inventory & fulfillment

A new shop opens in a different location. From that point on:

- **Local inventory per shop.** Each shop is a stock location with its own
  levels. Cashiers at Store 2 see what Store 2 physically has, not the
  aggregate.
- **Nearest-warehouse fallback.** When a customer buys a product that isn't
  on the shelf where they are — online or in-store — the platform routes to
  the nearest stocked warehouse.
- **Cross-warehouse pull protocol.** In-store sales that need warehouse
  stock follow a standardized flow: reserve the stock, communicate ETA to
  the customer, ship-to-store (or ship-to-customer), and reconcile.
- **Standardization for multi-store.** Everything above is expressed as
  policy on the sales channel + stock location relationship, so opening
  Store 3 is a config change, not a code change.

**Decisions needed:**
- Definition of "nearest" — straight-line geo, region grouping (states),
  or explicit per-channel priority list?
- Does Store 2 fulfill *online* orders for its city, or only in-store?
- Cross-warehouse pull destination: ship-to-store for pickup, ship-direct
  to customer, or cashier picks per order?

## 2. Last-mile delivery

Integrate a last-mile courier so delivery fees are estimated live at
checkout — both online and POS.

- Cart shows the delivery quote before payment.
- Estimate is per address, per weight/size bucket.
- Cashier can select "pickup" and skip the quote entirely.

**Decisions needed:**
- Provider(s) — options include Kwik, Sendbox, Gokada, GIG.
- Do we take the courier's exact quote, or add a markup?
- Which cities/states at launch?

## 3. Sales tax

Compute tax on orders at both the storefront and the POS.

- Nigeria VAT baseline: 7.5%.
- Tax appears as a distinct line on receipts and invoices.
- Reporting rolls up per-location, per-tax-category.

**Decisions needed:**
- Tax categories (VAT-exempt items, zero-rated goods, luxury tiers?).
- Do receipts need statutory display (TIN, business address, invoice
  number)?
- A4 invoice vs thermal receipt — do we need an A4 tax invoice for
  business-to-business sales? (See §7.)

## 4. Customer signup at POS checkout

The cashier can create a customer during checkout.

- Signup by **phone number** or by **email** — either is enough.
- Auto-attach to the current order.
- On future visits, phone or email lookup finds the existing customer.
- The customer can track their order later using the same identifier.

**Decisions needed:**
- Does phone signup require an OTP, or is a valid-format phone enough?
- SMS provider for OTP (Pulse already exists).
- Minimum data captured: name + phone/email, or more?

## 5. Customer order tracking

Related to §4 but separate. Customers can track an order they placed —
whether it was online, in-store pickup, or in-store delivery — using their
phone/email + order reference.

- Web page on the storefront (`/order/track` or similar).
- Shows current status, courier tracking link if applicable.
- Sends status transitions by email (already wired for order.placed,
  order.shipped, order.canceled) and optionally SMS.

## 6. Partner referral & incentive program

Partners are external people who refer customers to Ceedmart. Two ways to
apply their code:

- **At checkout** — customer enters a referral code (online or POS). Order
  is attributed to that partner.
- **Via WhatsApp** — every partner has a short **4-digit code**; when a
  customer contacts Ceedmart on WhatsApp we ask "which partner sent you"
  and record the code on the resulting order.

Admin reporting shows per-partner order counts, revenue, and commissionable
amounts.

**Decisions needed:**
- Commission model — % of order total, fixed per order, tiered by volume?
- Commission lifecycle trigger — placed, paid, delivered, delivered + no
  return after N days?
- Do referral codes stack with promotions/discounts, or are they mutually
  exclusive?
- Partner-facing dashboard (self-service reporting) or admin-only?
- 4-digit codes have a 10,000-partner ceiling — is that OK?

## 7. Receipts & communication

Three channels: thermal (existing), A4 (new), and e-receipt (new).

- **Thermal** — status quo. xprinter, cash-drawer trigger, tight width.
- **A4** — new print branch on the POS. Used when the customer needs a
  larger-format receipt or a proper invoice (business buyers, service
  contracts). Layout accommodates logo, itemized detail, tax invoice
  fields, warranty text.
- **E-receipt** — customer opts out of print. Receipt is emailed
  automatically (using the plain-text template infrastructure already in
  place). Same content as the thermal receipt.

**Decisions needed:**
- Is A4 always an invoice (with TIN etc.), or a distinct "long receipt"?
- Where does the cashier pick print target — before payment, after?
- E-receipt channel: email only, or SMS/WhatsApp too?

## 8. Order categorization & visual differentiation

Every order is typed on four dimensions:

| Dimension | Values |
|---|---|
| Channel | online, in-store |
| Location (in-store only) | Store 1, Store 2, … |
| Fulfillment | pickup, delivery |
| Sourcing | local stock, cross-warehouse pull |

Admin dashboards visualize each combination with color/badge. Ops filters
and reports roll up per any dimension.

**Decisions needed:**
- New order model field(s) or derive from sales_channel + fulfillment +
  stock_location?
- Do we need separate accounting ledgers for online vs in-store?

## 9. Low-stock alerting

When inventory for a product dips below a threshold, an email goes to the
relevant ops person.

- Per-product threshold with a sensible default rule.
- Alert per product per location.
- Hysteresis so a product hovering around threshold doesn't spam.

**Decisions needed:**
- Threshold: fixed absolute number, or fraction of typical velocity?
- Recipients: one central address, per-location manager, both?
- Snooze / silence window per product?

---

## System touch-points

| Capability | Backend | Admin | POS | Storefront |
|---|---|---|---|---|
| Multi-location inventory | Stock-location wiring, allocation rules | Location + transfer UI | Show local stock; block/route on OOS | Route to nearest, show ETA |
| Last-mile delivery | Fulfillment provider | Provider config | Quote at checkout | Quote at checkout |
| Sales tax | Tax rules per region | Tax config UI | Tax line on receipt | Tax line at cart |
| POS customer signup | Public signup + OTP | — | Signup form in checkout | Existing web signup |
| Customer order tracking | Public tracking endpoint | — | — | Track page |
| Partner referrals | Referral module + reporting | Partner admin | Code entry at checkout | Code entry at checkout |
| WhatsApp partner code | WhatsApp inbound handler | Inbound log view | — | — |
| A4 receipt | — | — | New print branch | — |
| E-receipt | Notification wiring | — | Cashier toggle | — |
| Order type differentiation | Metadata / model field | Dashboard badges + filters | Source captured on payment | Source captured on checkout |
| Low-stock alerts | Subscriber on inventory_level | Threshold config UI | — | — |

---

## Suggested phasing (draft — for discussion)

**Phase 2A — Foundations (multi-location + baseline ops):**
1. Store 2 setup as a stock location with its own catalog visibility
2. Order type / source categorization
3. Sales tax
4. Cross-warehouse fulfillment protocol

**Phase 2B — Customer & partner reach:**
5. POS customer signup
6. Customer order tracking
7. Partner referral program (code-based)
8. WhatsApp partner code

**Phase 2C — Delivery & experience polish:**
9. Last-mile delivery integration
10. A4 receipt printing
11. E-receipt option
12. Low-stock alerts

Phases are parallelizable where the touch-points don't overlap. 2A blocks
2C's delivery quoting (delivery needs to know the sourcing location).

---

## Open decisions summary

Grouped from the sections above — these are the calls to make before Phase
2A engineering starts.

1. Nearest-warehouse routing rule (geo vs region vs priority list)
2. Does Store 2 fulfill online orders for its city?
3. Cross-warehouse pull destination (shop pickup vs direct to customer)
4. Last-mile courier partner
5. Tax categories per product type
6. Statutory receipt display requirements
7. Customer signup OTP requirement
8. Referral commission model + lifecycle trigger
9. Partner-facing dashboard scope
10. A4 layout: invoice vs long-form receipt
11. E-receipt channels
12. Low-stock threshold + recipients + snooze
