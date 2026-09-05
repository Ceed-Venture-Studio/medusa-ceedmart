import { model } from "@medusajs/framework/utils"

// Delivery log for every notification we attempt (BRD §5.4: "notification
// delivery attempts, provider responses, and customer-visible messages must
// be logged").
//
// Today a failed send is caught and written to the console — see the
// try/catch around createNotifications in api/store/solar/quotes/route.ts.
// That is invisible to support: when a customer says "I never got the
// email", nobody can tell whether it was sent, bounced, or never attempted.
//
// This table answers that question. It also feeds the §12.4 alert on
// notification backlogs.

const NotificationLog = model
  .define("NotificationLog", {
    id: model.id({ prefix: "nlog" }).primaryKey(),

    // ── What was sent ─────────────────────────────────────────────
    channel: model.text(), // "email" | "sms" | "feed"
    template: model.text().nullable(),
    trigger_type: model.text().nullable(),
    // Recipient. Stored so support can confirm the address actually used,
    // which is often the answer ("we sent it to the old address").
    recipient: model.text().nullable(),
    subject: model.text().nullable(),

    // ── What it was about ─────────────────────────────────────────
    // The order / quote / auction the message concerns.
    resource_id: model.text().nullable(),
    resource_type: model.text().nullable(),
    correlation_id: model.text().nullable(),

    // ── What happened ─────────────────────────────────────────────
    // "sent" — provider accepted it. "failed" — provider rejected or threw.
    // "skipped" — we deliberately did not send (no recipient, deduped).
    status: model.text().default("sent"),
    // Whatever the provider gave back: message id, queue id, error body.
    // Untyped because each Pulse channel answers differently.
    provider_response: model.json().nullable(),
    error_message: model.text().nullable(),

    // Non-null when the send was retried, so a backlog is visible as a
    // count rather than inferred from duplicate rows.
    attempt: model.number().default(1),
  })
  .indexes([
    { on: ["status"] },
    { on: ["channel"] },
    { on: ["resource_id"] },
    { on: ["trigger_type"] },
    { on: ["correlation_id"] },
    { on: ["created_at"] },
  ])

export default NotificationLog
