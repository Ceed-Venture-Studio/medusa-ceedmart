import { model } from "@medusajs/framework/utils"

// A customer's request for a custom PC or laptop (BRD §7.5).
//
// The assisted path: the customer describes an OUTCOME — what they want to
// do with the machine and what they can spend — and a specialist turns that
// into a configuration and a quote. §7.10 requires that "a customer can
// submit an assisted request WITHOUT KNOWING COMPONENT TERMINOLOGY", which
// is why nothing here asks for a socket type or a wattage.
//
// Modelled on modules/solar, which already runs this shape in production:
// public submit, sales notification, admin review, status transitions.

const BuildRequest = model
  .define("BuildRequest", {
    id: model.id({ prefix: "bldr" }).primaryKey(),
    // Human-readable reference for WhatsApp, email and phone support
    // (§9.4 "every record must have a reference number suitable for
    // WhatsApp, email, or phone support"). "CB-4821", not a ULID.
    reference: model.text().unique(),

    // ── Who ───────────────────────────────────────────────────────
    customer_id: model.text().nullable(),
    customer_name: model.text(),
    customer_email: model.text(),
    customer_phone: model.text().nullable(),
    delivery_state: model.text().nullable(),

    // ── What they want, in their own words ────────────────────────
    // "desktop" | "laptop"
    build_type: model.text().default("desktop"),
    // Free-form intended use: gaming, video editing, CAD, office, trading.
    intended_use: model.text(),
    // Budget in kobo. A range rather than a figure, because a customer who
    // has not priced components does not have a figure — and asking for one
    // makes them guess low and feel misled later.
    budget_min: model.bigNumber().nullable(),
    budget_max: model.bigNumber().nullable(),
    currency_code: model.text().default("ngn"),

    preferred_brands: model.json().nullable(),
    // Applications or games they need it to run — more useful than any
    // spec the customer could give us.
    required_software: model.json().nullable(),
    performance_notes: model.text().nullable(),
    portability_needs: model.text().nullable(),
    required_accessories: model.json().nullable(),
    // When they need it by. Drives the deadline warning on the quote.
    needed_by: model.dateTime().nullable(),
    notes: model.text().nullable(),

    // ── Lifecycle ─────────────────────────────────────────────────
    // Values come from buildOrderMachine in lib/state-machine/machines.
    status: model.text().default("submitted"),
    assigned_to: model.text().nullable(),
    // Set when staff need more from the customer, so the request can be
    // filtered out of the "waiting on us" queue.
    awaiting_customer_since: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["reference"], unique: true },
    { on: ["status"] },
    { on: ["customer_email"] },
    { on: ["customer_id"] },
    { on: ["assigned_to"] },
    { on: ["created_at"] },
  ])

export default BuildRequest
