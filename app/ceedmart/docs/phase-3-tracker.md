# Ceedmart Phase 3 — Delivery Tracker

**Companion to** `phase-3-brd.md` (the business source of truth) and the
engineering gap analysis. That pair captures *what* and *why*. This tracks
*which ticket*, *in what order*, and *whether it is done*.

**Status key** — `todo` / `in-progress` / `done` / `blocked`.

Branch convention: one `feat/p<n>-<slug>` branch per phase, commit at the end
of each phase once its gate passes.

---

## Phase 0 — Foundations

Nothing customer-visible ships. Everything after this depends on it.

| # | Ticket | Status |
|---|---|---|
| P0-1 | Fix the metadata clobber — one writer, backend + storefront | **done** |
| P0-2 | `audit` module — `AuditEvent` + transition helper | **done** |
| P0-3 | `terms` module — versioned documents, per-transaction acceptance | **done** |
| P0-4 | `listing_policy` module + commerce-type badge surfaces | **done** |
| P0-5 | `src/jobs/` scaffold + one job proving restart idempotency | **done** |
| P0-6 | `REDIS_URL` a hard production requirement | **done** |
| P0-7 | Feature-flag mechanism across backend, storefront, POS | **done** |
| P0-8 | Notification delivery logging — attempts + provider responses | **done** |

**Gate:** **passed.** `runOnce` performs work exactly once across a
restart-style retry and across concurrent instances — proven in
`src/lib/jobs/idempotency.spec.ts`. Solar quote status changes now go through
`solarQuoteMachine.transition`, which writes one `AuditEvent` per accepted
change and rejects illegal moves (`src/api/admin/solar/quotes/[id]/status/route.ts`).

**Note on the claim mechanism.** The first implementation leased work through
the cache module. Its concurrency tests failed: Medusa's cache exposes only
get/set/invalidate, so claiming was a read followed by a write and two
instances both won. The claim moved to Postgres, where a unique index
arbitrates atomically in a single statement — see `src/modules/job-claim`.

---

## Phase 1 — US Pre-Order MVP

| # | Ticket | Status |
|---|---|---|
| P1-1 | `preorder` module and migrations | **done** |
| P1-2 | Admin: mark eligible, landed price, source + condition metadata | **done** |
| P1-3 | Product page — badge, delivery estimate, cost disclosure | **done** |
| P1-4 | Cart/checkout fulfilment-group separation for mixed carts | **done** |
| P1-5 | Terms acceptance at checkout, version-bound, snapshotted | **done** |
| P1-6 | Twelve-state milestone machine + customer-facing simplification | **done** |
| P1-7 | Milestone notifications and the sourcing exception queue | **done** |
| P1-8 | Cancellation and refund by milestone, with reason codes | **done** |

**Gate:** **passed.** `preorder-capture` freezes unit price, FX rate, cost
breakdown, condition, warranty and terms version onto a `PreorderOrder` at
`order.placed`, keyed uniquely on `line_item_id` so a redelivered event cannot
double-create. The promised date is set at `sourcing_confirmed`, not payment
(§6.2), and pauses while waiting on a customer approval. Exception rows carry
`exception_at` and sort to the top of the ops queue, so a stuck order cannot
present as normally progressing.

**Decisions taken:** D-01 — the window is three settable legs per offer
(procurement / transit / customs) rather than a fixed fortnight, with an
optional total override. D-02 — locked all-inclusive naira price; the cost
breakdown is internal only and never reaches the storefront.

**Admin page:** `src/admin/routes/preorders/page.tsx` — offers (create, verify
availability, publish, margin and FX-drift flags) and the ops queue, which sorts
exceptions and overdue orders above everything else because §6.5 forbids a
delayed order presenting as normally progressing. Milestone drawer records
carrier, tracking and a customer-facing note; refunds go through reason codes.
Verified by a full `medusa build`, which bundles the admin frontend.

**Not tested automatically:** the storefront has no test runner (no jest or
vitest config, no `test` script). Its changes are verified by typecheck only,
which fell from 23 pre-existing errors to 21.

---

## Phase 2 — Assisted Custom Builds MVP

| # | Ticket | Status |
|---|---|---|
| P2-1 | `build` module, modelled on `modules/solar` | **done** |
| P2-2 | Requirements questionnaire | **done** |
| P2-3 | Versioned quotes — new versions never overwrite | **done** |
| P2-4 | Accept / reject / request-revision with acceptance snapshot | **done** |
| P2-5 | Accepted quote converts to a payable order | **done (record)** — payment collection pending |
| P2-6 | Build milestones and the QA checklist gating dispatch | **done** |
| P2-7 | Quote expiry job on the P0 scheduler | **done** |

**Gate:** **passed.** The request form asks only about outcomes — intended
use, budget range, software that must run — and never for a socket, chipset or
wattage. `assertReadyForDispatch` blocks the `ready_for_dispatch` transition
until every required QA check has passed, naming what is outstanding; a FAILED
required check blocks as firmly as an unchecked one, and an empty checklist
counts as skipped rather than passed.

**Design notes.** Quote revisions are new `BuildQuoteVersion` rows with no
update path, so §7.6's "changes create a new version without overwriting prior
versions" is structural rather than disciplinary. `canAcceptVersion` enforces
"only the latest valid quote can be accepted" server-side and separates the two
failure modes — superseded and expired get different messages, since a generic
refusal makes both look like a bug. Totals are recomputed from line items
server-side per §7.9. The QA checklist is seeded from a fixed template at
acceptance, so it cannot be assembled ad hoc for a build that is running late.

**Outstanding for P2-5:** an accepted quote creates a `BuildOrder` and emails
the customer, but does not yet raise a Medusa order or payment collection.
Wiring that needs the same Pulse Pay answer blocking auction deposits (R2) for
the deposit half of D-07; the full-payment path could ship first.

**Admin page:** `src/admin/routes/builds/page.tsx` — the request queue (sorted
so requests waiting on US come first), a quote builder that sends a new version
each time, and a QA drawer where each check is recorded individually. Failing or
skipping a check requires a note. When dispatch is blocked, the server's message
names the outstanding checks and the drawer surfaces it verbatim.

---

## Phase 3 — Guided PC/Laptop Builder

| # | Ticket | Status |
|---|---|---|
| P3-1 | `build_catalog` module | **done** |
| P3-2 | Compatibility engine, server-authoritative | **done** |
| P3-3 | Guided PC configurator UI | **done** |
| P3-4 | Laptop configurator from real purchasable variants | **done** |
| P3-5 | Saved drafts, references, duplication | **done** |
| P3-6 | Configuration converts into the Phase 2 quote pipeline | **done** |

**Gate:** **passed.** Every rule carries a customer-readable `message` and a
`remedy` — a test asserts no message contains a SCREAMING_CASE rule name.
`/store/builds/validate` is the authority and reads component attributes from
the catalogue, never from the request body, so a client cannot declare two
parts compatible by asserting it; the browser runs the same rules only for
instant feedback.

**Design notes.** Rules are DATA, not functions: each row compares an attribute
on one slot against an attribute on another via an operator, so a new socket
generation is a row rather than a deploy. The engine SKIPS a rule whose
attributes are missing on either side rather than failing it — telling a
customer their parts clash because we lack data about them is worse than
staying quiet, and a specialist reviews every configuration before it becomes a
quote. Blocking findings can never be acknowledged away; warnings can, and an
acknowledgement for a warning no longer raised is ignored rather than carried
forward. Changing any part clears prior acknowledgements.

`P3-6` converges on the Phase 2 pipeline: a submitted configuration becomes an
ordinary `BuildRequest`, so guided and assisted builds share one specialist
review, one versioned quote and one QA-gated build. The configurator is a
better front door, not a second pipeline.

**Seeding:** `npx medusa exec ./src/scripts/seed-build-catalog.ts` loads the 20
slots and 15 rules. Component OPTIONS are deliberately not seeded — they are
real parts with real prices and belong to whoever maintains the catalogue.

**Flag:** `FEATURE_BUILD_CONFIGURATOR` is separate from `FEATURE_CUSTOM_BUILD`
per D-06, so the assisted form can be live while the builder is still off.

---

## Phase 4 — Auctions MVP

**Unblocked 5 Sep 2026.** Pulse Pay supports authorisation-without-capture and
partial refunds; production gets dedicated Redis; phone verification gates
BIDDING only, per BRD §5.2 — H4's no-OTP POS signup stands, and a shopper who
never bids never meets an OTP.

| # | Ticket | Status |
|---|---|---|
| P4-1 | Email + phone verification for bidders (Pulse Identity) | **done** |
| P4-2 | `auction` module and migrations | **done** |
| P4-3 | Admin creation, validation, preview, publish | **done** |
| P4-4 | Atomic bid endpoint — row lock + unique sequence | **done** |
| P4-5 | Concurrency test suite | **done** |
| P4-6 | Activation and closing jobs, idempotent across retry | **done** |
| P4-7 | Anti-sniping extension, persisted + polled | **done** |
| P4-8 | Winner payment window, reminders, unit reservation | **done** |
| P4-9 | Default handling — next-bidder offer or relist | **done** |
| P4-10 | Bidder deposits (conditional on gateway support) | **done** |
| P4-11 | POS guard — auction units refused at barcode lookup | **done** |

**Gate:** **passed.** Two concurrent bids cannot take the same sequence — the
second validates against the first's committed price and is rejected as below
minimum; asserted in `concurrency.spec.ts` for both a pair and a burst of
twelve. A closing job that runs twice returns the first outcome unchanged, even
if the bid ledger changed between runs.

**Concurrency design.** Three independent layers, because an auction closing
twice means two people are told they won: `runOnce` claims each auction so
instances split the batch; `placeBid` / `closeAuction` take `SELECT … FOR
UPDATE` on the auction row so callers serialise; and unique indexes on
`(auction_id, sequence)` and `auction_result.auction_id` refuse a duplicate even
if both earlier layers failed. The third is the actual guarantee — the first two
make it cheap.

The bid RULES live in `lib/auction/rules` as pure functions and are applied
inside the lock, rather than restated in SQL. Two definitions of a bid's
validity would drift apart; the transaction's job is concurrency, not
arithmetic.

**Anti-sniping** measures the extension from the bid, not the old end time — a
bid with one second left gives everyone the full five minutes back, which is
what actually defeats sniping. Persisted in the same transaction so a crash
cannot lose it.

**Nothing here charges anyone.** §8.9 forbids silently charging a next bidder,
and the same restraint is applied to the original winner: defaulting forfeits an
already-authorised deposit and never initiates a payment. Deposits record
authorisation and capture in separate columns so a hold is never mistaken for
money taken.

**Voiding a bid** keeps the row and its consumed sequence with a mandatory
reason (§8.6), and is refused entirely once a result exists — a closed auction's
outcome is a snapshot, and re-deciding it needs a dispute, not a side effect.

**P4-11:** the POS barcode lookup now refuses auction lots and custom builds
outright, and surfaces a cashier warning on pre-orders rather than ringing them
up as shelf stock.

---

## Verification

Two scripts, kept because the same class of bug kept getting through.

Six runtime bugs this cycle passed `tsc`, 259 unit tests and a full `medusa
build`, and were found only by running the app: three schema mismatches, three
storefront failures. Neither category is reachable from a type checker — one
needs a database, the other needs a request.

**`yarn verify:schema`** (backend) applies every migration to an empty database
and writes one row for each of the 39 models across all 17 custom modules. It
catches the three schema bugs that shipped: `raw_<field>` companion columns
written as `<field>_raw`, models whose derived table name the migration never
created, and fields on a model no migration added. Each was verified to fail
this script by reintroducing it. See `scripts/README.md`.

Running against a FRESH database is the point — the dev database has been
patched by hand and can pass while a clean checkout fails. `commission_entry`
carried the `raw_` bug from the day M3 shipped, silently, because the subscriber
caught and logged the error rather than surfacing it.

**`yarn smoke`** (storefront) drives the running app over HTTP across three
tiers. It catches the `"use server"` export violations and the middleware asset
redirect, both of which broke every page while every test stayed green. See the
storefront's `scripts/README.md`.

Neither is wired into CI yet.

---

## Turning the features on

Every Phase 1–4 feature is behind a flag, and **all of them default off**.
Nothing is broken when a new environment shows no pre-orders, no builds and
no auctions — nothing has been switched on yet. The store routes return
`not_found` and the pages render their unavailable state, which looks
exactly like a bug and is not one.

Set in the backend's `.env`, then restart:

```
FEATURE_PREORDER=true            # US pre-order listings, cart and checkout
FEATURE_CUSTOM_BUILD=true        # build requests and quotes
FEATURE_BUILD_CONFIGURATOR=true  # the guided PC/laptop configurator
FEATURE_AUCTION=true             # auctions visible, bids accepted
```

Check what is live without guessing:

```
curl -s localhost:9100/store/feature-flags -H "x-publishable-api-key: <pk>"
```

They are environment variables rather than database rows on purpose: a flag
that lives in the same database as the feature it guards cannot be used to
turn that feature off when the database is the problem.

`FEATURE_BUILD_CONFIGURATOR` is separate from `FEATURE_CUSTOM_BUILD` (D-06)
so the assisted flow can ship before the self-serve configurator.
