import { model } from "@medusajs/framework/utils"

// Append-only audit trail (BRD §5.5).
//
// Every material administrative action records who did it, when, what the
// value was before, what it became, and why. Rows are never updated or
// deleted — a correction is a new row, exactly as commission entries post
// counter-entries rather than mutating history.
//
// The BRD also forbids staff from altering historical bids and paid order
// totals (§5.5, §8.6). Enforcing that is the job of the writing code; this
// table is what makes any attempt visible after the fact.
//
// Written by lib/state-machine on every accepted transition, so audit
// coverage is a property of the transition mechanism rather than something
// each route has to remember.

const AuditEvent = model
  .define("AuditEvent", {
    id: model.id({ prefix: "audit" }).primaryKey(),

    // ── What was touched ──────────────────────────────────────────
    // Entity type as a stable slug: "preorder", "build_quote", "auction",
    // "bid", "order". Not a foreign key — audit rows outlive the rows they
    // describe, and must survive a hard delete of the subject.
    entity_type: model.text(),
    entity_id: model.text(),

    // ── What happened ─────────────────────────────────────────────
    // "transition" for a state change, otherwise a verb slug such as
    // "quote.revised", "bid.voided", "auction.cancelled".
    action: model.text(),
    from_value: model.text().nullable(),
    to_value: model.text().nullable(),
    // Fuller before/after payload when a single from/to pair is too coarse.
    changes: model.json().nullable(),

    // ── Who did it ────────────────────────────────────────────────
    // "user" (staff), "customer", or "system" for jobs and subscribers.
    actor_type: model.text().default("system"),
    actor_id: model.text().nullable(),
    // Denormalised so the trail stays readable after a staff member leaves
    // and their user record is removed.
    actor_label: model.text().nullable(),

    // ── Why ───────────────────────────────────────────────────────
    // Required by §5.5 "and reason where relevant" — the writing code
    // decides when to demand one.
    reason: model.text().nullable(),

    // Correlation identifier linking customer, order, payment, quote,
    // auction and support events for one journey (BRD §12.4).
    correlation_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["entity_type", "entity_id"] },
    { on: ["actor_id"] },
    { on: ["action"] },
    { on: ["correlation_id"] },
    { on: ["created_at"] },
  ])

export default AuditEvent
