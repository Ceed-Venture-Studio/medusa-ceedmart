import { model } from "@medusajs/framework/utils"

// Whether a customer may bid (BRD §5.2, §8.2).
//
// §5.2: "a verified email address and verified Nigerian phone number are
// required before bidding."
//
// Kept as its own record rather than flags on the customer because
// verification here gates BIDDING specifically — the H4 decision to let
// cashiers create POS customers without an OTP still stands for ordinary
// commerce. A shopper who never bids never meets an OTP.
//
// Verification runs through Pulse Identity; this row records the OUTCOME so
// the bid path does not call an external service on every bid.

const BidderEligibility = model
  .define("BidderEligibility", {
    id: model.id({ prefix: "bide" }).primaryKey(),
    customer_id: model.text().unique(),

    email: model.text().nullable(),
    email_verified_at: model.dateTime().nullable(),

    phone: model.text().nullable(),
    phone_verified_at: model.dateTime().nullable(),

    // Short-lived OTP state. The code itself is hashed — a support agent
    // reading the table should not be able to bid as a customer.
    phone_otp_hash: model.text().nullable(),
    phone_otp_expires_at: model.dateTime().nullable(),
    phone_otp_attempts: model.number().default(0),
    phone_otp_sent_at: model.dateTime().nullable(),

    // Set when we bar someone from bidding — repeated defaults, fraud.
    // §8.10's dispute workflow feeds this.
    is_barred: model.boolean().default(false),
    barred_reason: model.text().nullable(),
    barred_at: model.dateTime().nullable(),

    // Running count of auctions won but never paid for. Used by the
    // winner-default policy (§8.9).
    default_count: model.number().default(0),
  })
  .indexes([
    { on: ["customer_id"], unique: true },
    { on: ["is_barred"] },
  ])

export default BidderEligibility
