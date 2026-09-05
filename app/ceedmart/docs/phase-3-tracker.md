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
| P1-1 | `preorder` module and migrations | todo |
| P1-2 | Admin: mark eligible, landed price, source + condition metadata | todo |
| P1-3 | Product page — badge, delivery estimate, cost disclosure | todo |
| P1-4 | Cart/checkout fulfilment-group separation for mixed carts | todo |
| P1-5 | Terms acceptance at checkout, version-bound, snapshotted | todo |
| P1-6 | Twelve-state milestone machine + customer-facing simplification | todo |
| P1-7 | Milestone notifications and the sourcing exception queue | todo |
| P1-8 | Cancellation and refund by milestone, with reason codes | todo |

**Gate:** a paid pre-order carries an immutable price, terms version and promised
date, and cannot display as normally progressing once in an exception state.

---

## Phase 2 — Assisted Custom Builds MVP

| # | Ticket | Status |
|---|---|---|
| P2-1 | `build` module, modelled on `modules/solar` | todo |
| P2-2 | Requirements questionnaire | todo |
| P2-3 | Versioned quotes — new versions never overwrite | todo |
| P2-4 | Accept / reject / request-revision with acceptance snapshot | todo |
| P2-5 | Accepted quote converts to a payable order | todo |
| P2-6 | Build milestones and the QA checklist gating dispatch | todo |
| P2-7 | Quote expiry job on the P0 scheduler | todo |

**Gate:** a customer can submit without component knowledge, and staff cannot
mark a build ready for dispatch with an incomplete QA checklist.

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
