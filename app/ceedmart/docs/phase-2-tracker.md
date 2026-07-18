# Ceedmart Phase 2 — Delivery Tracker

**Companion to** `phase-2-scope.md`. That doc captures *what* and *why*.
This tracks *when*, *in what order*, and *how we prove each piece works*.

**Priority key**
- **H** — key path to multi-store, small-to-medium scope, do first.
- **M** — important but bigger scope; ships after H items land.
- **L** — heavy lifting or blocked on external inputs; parked.

**Test gate key**
- **U** — Unit tests (isolated function / module).
- **I** — Integration tests (HTTP endpoint or module wired to real DB).
- **E** — UI / end-to-end (manual acceptance script unless noted).

**Status key** — `todo` / `in-progress` / `review` / `done` / `blocked`.

---

## HIGH priority — start here

### H1. Store 2 setup as stock location
Config-only prep so every other multi-location task has somewhere to point.
**Scope:**
- Create a second `stock_location` for Store 2 (name, address).
- Create a Store 2 sales channel; link to the new stock location.
- Seed a small inventory subset for the new location.
- Verify the POS built for Store 2 sees only its own catalog.

**Test gates:**
- **U:** none (config only).
- **I:** `/pos/sync/catalog/:store2_scid` returns products with Store 2 inventory quantities, distinct from Store 1's.
- **E:** launch POS pointed at Store 2 sales channel, confirm product list & stock levels match seed data.

**Deps:** none. **Owner:** —. **Status:** todo.

---

### H2. Sales tax per collection
Every product's tax rate is derived from its Medusa collection. Nigeria VAT
7.5% is the default; some collections may be zero-rated (final list TBD).
**Scope:**
- Register a `tax_region` for Nigeria with a 7.5% default rate.
- For each collection that needs a non-default rate, register a `tax_rate`
  with a `TaxRateRule` targeting `reference: "product_collection"`.
- Verify tax appears on order.summary, receipts, and email.
- Storefront cart and POS both show a tax line before payment.

**Test gates:**
- **U:** helper `resolveTaxRateForProduct(productId)` returns the right
  rate for products in each collection.
- **I:** create an order via `/store/carts/:id/complete` for a product in a
  taxed collection and one in a zero-rated collection; assert
  `summary.tax_total` matches expected.
- **E:** run one POS sale and one storefront checkout, verify the receipt
  shows the correct tax line and the email includes it.

**Deps:** none. **Owner:** —. **Status:** todo.

---

### H3. Order type / source categorization
Every order carries typed metadata for channel, location, fulfillment, and
sourcing. Admin dashboard shows a badge per type.
**Scope:**
- Standardize `order.metadata`: `{ ceedmart: { channel: "online"|"in-store", store_id?: string, fulfillment: "pickup"|"delivery", sourcing: "local"|"cross-warehouse" } }`.
- POS writes these on capture; storefront writes on cart completion.
- Admin order-detail widget renders a color badge; order-list page adds a
  filter dropdown for channel + fulfillment.
- Report endpoint at `/admin/orders/report` aggregates counts per
  dimension.

**Test gates:**
- **U:** POS reducer that composes the metadata object from cart + store
  state returns the expected shape.
- **I:** completed orders (POS + storefront) end up with the correct
  metadata block in the DB.
- **E:** open an order in admin, badge shows correctly for each of
  online / in-store / pickup / delivery.

**Deps:** H1 for store_id values. **Owner:** —. **Status:** todo.

---

### H4. POS customer signup (no OTP)
Cashier can create a customer record inline during checkout via phone or
email. No OTP — cashier types, we save.
**Scope:**
- New POS drawer within the payment flow: "Add customer".
- Backend endpoint `/pos/customers` — create if not exists, return the
  matched customer if phone/email already present (idempotent).
- On order capture, link `customer_id` to the order.

**Test gates:**
- **U:** validator on `/pos/customers` rejects malformed phone/email,
  accepts either alone or both.
- **I:** POST with a new phone → 201 with created customer; POST again
  with same phone → 200 with existing customer (no duplicate row).
- **E:** cashier flow — add a customer during POS checkout, confirm the
  admin order detail shows the customer attached.

**Deps:** none. **Owner:** —. **Status:** todo.

---

### H5. Customer order tracking (guest + signed-in)
Public tracking page — customer enters phone/email + order reference,
sees status and (later) courier tracking.
**Scope:**
- Public endpoint `/store/orders/track?ref=<display_id>&contact=<phone|email>` — returns limited fields (status, items count, total, tracking URL if any). Rate-limited.
- Storefront route `/<country>/track` with a form + result panel.
- Order confirmation email already links to `/order/:id/confirmed`; add a
  copy pointing at `/track?ref=…` as the persistent link customers can
  bookmark.

**Test gates:**
- **U:** contact-matching helper: given order + input, returns true only
  when phone or email matches.
- **I:** track endpoint returns 200 for matching input, 404 for
  non-matching, 429 after N requests/min from same IP.
- **E:** place a test order, use its ref on the track page, confirm the
  status appears.

**Deps:** none. **Owner:** —. **Status:** todo.

---

### H6. Low-stock alerts
Central inbox receives an email when any SKU dips below a threshold.
Fixed absolute threshold per product (default 5); snooze 3 days per SKU.
**Scope:**
- Extend product/variant metadata with `low_stock_threshold` (nullable).
- New subscriber on `inventory-level.updated` — checks post-update
  stocked_quantity per location and compares to threshold.
- Dedupe in Redis via a key `low_stock:{variant_id}:{location_id}` with 3d
  TTL — no re-alert while the key exists.
- Sends via the existing plain-text notification pipeline.
- Admin config: single `LOW_STOCK_ALERT_EMAIL` env var; default threshold
  in a store-metadata field.

**Test gates:**
- **U:** dedupe key generation + threshold-crossing logic.
- **I:** manually drop inventory below threshold via `/admin/inventory-items/:id/location-levels/:loc/update`, assert `notification.createNotifications` was called with the right recipient.
- **E:** none required (email is the outcome).

**Deps:** none. **Owner:** —. **Status:** todo.

---

### H7. E-receipt (email + SMS)
Cashier toggles a "send receipt digitally" option on the POS payment
screen. If on, no thermal print — receipt is emailed and SMS'd to the
customer instead.
**Scope:**
- POS: checkbox in payment dialog; when checked and customer has
  phone/email on the order, skip `printOrderReceipt()`.
- Backend: on `order.placed` (already subscribed), emit an additional
  `order.receipt` notification with the itemized breakdown to the
  channels the cashier picked (email always; SMS if phone present).
- Same body/format as thermal receipt, adapted for text.

**Test gates:**
- **U:** the "receipt to email/SMS" body renders the same items/totals as
  the thermal receipt for a given order fixture.
- **I:** place an order with `metadata.ceedmart.e_receipt=true`, assert
  notification module was invoked for email + SMS channels.
- **E:** cashier checks the box, no printer fires, email + SMS land.

**Deps:** none. **Owner:** —. **Status:** todo.

---

## MEDIUM priority

### M1. Cross-warehouse pull protocol
When Store 2 sells a product it doesn't have in stock, reserve inventory
at PH warehouse and mark the order for shop-pickup once the transfer
arrives. Bigger workflow — split into sub-tasks.
**Sub-tasks:**
- M1a. Sourcing decision at cart time (Store 2's channel priority
  list from H1 decision A: Store 2 → PH warehouse → Store 1). Returns the
  source location for each item.
- M1b. Reservation workflow at capture time: `reservation` row against
  the source location, linked to the order.
- M1c. Admin surface: "Awaiting transfer" order badge + list.
- M1d. Order status transition when the item physically arrives at the
  shop: cashier marks "arrived" → notifies customer via SMS/email.

**Test gates (per sub-task):**
- **U:** sourcing rule picks the correct location for each combination of
  channel + variant + local stock.
- **I:** completing a cart with mixed local + warehouse items creates the
  right reservation rows; marking "arrived" clears them.
- **E:** run a full cashier flow that hits a cross-warehouse pull,
  confirm the badge appears and the customer notification fires.

**Deps:** H1 (Store 2 exists), H3 (metadata field for sourcing).
**Status:** todo.

---

### M2. A4 receipt printing (long-form)
Alternate print branch on the POS that renders a paginated A4 receipt via
the OS print dialog rather than the xprinter thermal driver.
**Scope:**
- Tauri: implement `print_a4_receipt` command invoking OS print API with
  an HTML template rendered to PDF.
- POS: "Print A4 copy" button next to the existing print button on the
  order-complete screen.
- Layout: same info as thermal, larger font, itemized table, footer with
  Ceedmart brand + return policy text.

**Test gates:**
- **U:** HTML template rendering — given an AdminOrder fixture, snapshot
  the resulting HTML.
- **I:** none (print is OS-native).
- **E:** print an A4 copy from a real order on a Mac (Preview.app dialog)
  and Windows (system print dialog). Confirm layout doesn't overflow.

**Deps:** none. **Status:** todo.

---

### M3. Partner referral program
Referral module + admin UI + POS/storefront code entry. Commission model
lives in a doc you'll share.
**Sub-tasks:**
- M3a. Backend `partner` + `referral_code` modules with CRUD admin
  endpoints.
- M3b. POS + storefront: single input for "Referral code" at checkout;
  saved to `order.metadata.ceedmart.referral_code_id`.
- M3c. Admin reporting page: per-partner order counts, total revenue,
  commissionable amount (formula pending your doc; ships as read-only
  first pass).

**Test gates:**
- **U:** code validator (format + existence + not-revoked).
- **I:** applying a code on a checkout → order row carries the referral
  metadata; admin report endpoint returns aggregated rows.
- **E:** apply a code in POS + storefront, confirm both attribute
  correctly in the admin report.

**Deps:** commission model doc (open). **Status:** blocked on doc.

---

## LOW priority

### L1. Last-mile delivery — internal Lastmile API
Blocked on the internal Lastmile API spec / build. Ships as its own
sub-project.
**Scope (once unblocked):**
- New fulfillment provider module wrapping the Lastmile HTTP client.
- Quote endpoint invoked at cart time by both POS and storefront.
- Book delivery on order capture; poll status; surface to admin + customer
  tracking page (H5).

**Test gates:** Unit for HTTP client, integration with Lastmile sandbox
if provided, manual E2E for a real delivery.

**Deps:** Lastmile API spec, credentials, sandbox env. **Status:**
blocked.

---

### L2. WhatsApp partner code capture
Requires a WhatsApp Business inbound webhook. Deferred until we scope the
WhatsApp integration itself.
**Status:** blocked on WhatsApp inbound integration.

---

## Cross-cutting engineering hygiene

Not features but should land alongside Phase 2A.
- Ensure `medusa db:migrate` runs cleanly against a fresh Postgres for all
  new modules (add to CI).
- Extend the sync/integration test harness in
  `/integration-tests/{api,factories}` with factories for `partner`,
  `referral_code`, `low_stock_threshold`.

---

## Rollout order

1. H1 → H2 → H3 in that order (H3 needs H1's store_id, H2 is standalone).
2. H4 → H5 in parallel with H6 → H7.
3. M2 alongside H7 (both touch receipt code).
4. M1 after H1/H3 are stable.
5. M3 once the commission doc lands.
6. L1/L2 whenever their external deps arrive.

Every H item is scoped as a single PR. M items may need 2–3 PRs each.
