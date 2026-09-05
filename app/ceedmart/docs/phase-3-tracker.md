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
| P1-2 | Admin: mark eligible, landed price, source + condition metadata | **done (API)** — admin UI page pending |
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

**Outstanding for P1-2:** the admin dashboard PAGE. Every endpoint exists and
is audited (`/admin/preorders/offers`, `/suppliers`, the queue, transitions and
refunds), but no React route under `src/admin/routes/` renders them yet — ops
would drive this with an API client today.

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

**Also outstanding:** no admin dashboard pages for builds (same gap as P1-2) —
the endpoints exist and are audited, nothing renders them.

---

## Phase 3 — Guided PC/Laptop Builder

| # | Ticket | Status |
|---|---|---|
| P3-1 | `build_catalog` module | todo |
| P3-2 | Compatibility engine, server-authoritative | todo |
| P3-3 | Guided PC configurator UI | todo |
| P3-4 | Laptop configurator from real purchasable variants | todo |
| P3-5 | Saved drafts, references, duplication | todo |
| P3-6 | Configuration converts into the Phase 2 quote pipeline | todo |

**Gate:** every blocking incompatibility is explained in plain language, and no
validation exists only on the client.

---

## Phase 4 — Auctions MVP

**Blocked** on three decisions: Pulse Pay auth-hold/partial-refund support,
production Redis, and the bidder phone-verification scope.

| # | Ticket | Status |
|---|---|---|
| P4-1 | Email + phone verification for bidders (Pulse Identity) | blocked |
| P4-2 | `auction` module and migrations | blocked |
| P4-3 | Admin creation, validation, preview, publish | blocked |
| P4-4 | Atomic bid endpoint — row lock + unique sequence | blocked |
| P4-5 | Concurrency test suite | blocked |
| P4-6 | Activation and closing jobs, idempotent across retry | blocked |
| P4-7 | Anti-sniping extension, persisted + polled | blocked |
| P4-8 | Winner payment window, reminders, unit reservation | blocked |
| P4-9 | Default handling — next-bidder offer or relist | blocked |
| P4-10 | Bidder deposits (conditional on gateway support) | blocked |
| P4-11 | POS guard — auction units refused at barcode lookup | blocked |

**Gate:** two concurrent bids cannot both be accepted at the same sequence, and
a closing job that runs twice produces one winner.
