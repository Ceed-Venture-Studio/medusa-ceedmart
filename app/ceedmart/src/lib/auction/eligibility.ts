import { createHash, randomInt, timingSafeEqual } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { AUCTION_MODULE } from "../../modules/auction"
import { sendNotification } from "../notifications/send"

// Bidder verification (BRD §5.2, §8.2).
//
// "A verified email address and verified Nigerian phone number are required
// before bidding."
//
// ── Scope ───────────────────────────────────────────────────────────────
// This gates BIDDING, not customer accounts. The H4 decision — cashiers
// create POS customers without an OTP — stands untouched; a shopper who
// never bids never meets a verification step. That keeps one identity
// requirement in one place instead of imposing OTP on all of retail.
//
// ── Handling the code ───────────────────────────────────────────────────
// The OTP is stored HASHED. A support agent reading the table must not be
// able to bid as a customer, and a database dump must not be a set of live
// credentials. Comparison is constant-time so the endpoint cannot be used
// as an oracle.

const OTP_LENGTH = 6
const OTP_TTL_MINUTES = Number(process.env.BIDDER_OTP_TTL_MINUTES || 10)
const OTP_MAX_ATTEMPTS = Number(process.env.BIDDER_OTP_MAX_ATTEMPTS || 5)
const OTP_RESEND_SECONDS = Number(process.env.BIDDER_OTP_RESEND_SECONDS || 60)

const hashOtp = (code: string, customerId: string): string =>
  // Salted with the customer id so identical codes for two customers do not
  // produce identical hashes.
  createHash("sha256").update(`${customerId}:${code}`).digest("hex")

const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Normalise a Nigerian mobile number to E.164.
 *
 * Accepts the forms people actually type — 08012345678, 8012345678,
 * +2348012345678, 234 801 234 5678 — and returns +2348012345678, or null
 * when it is not a plausible Nigerian mobile.
 */
export const normaliseNigerianPhone = (input: string): string | null => {
  const digits = (input || "").replace(/\D/g, "")
  if (!digits) return null

  let local: string
  if (digits.startsWith("234")) local = digits.slice(3)
  else if (digits.startsWith("0")) local = digits.slice(1)
  else local = digits

  // Nigerian mobile numbers are 10 digits after the country code and start
  // with 7, 8 or 9.
  if (local.length !== 10) return null
  if (!/^[789]/.test(local)) return null

  return `+234${local}`
}

export type Eligibility = {
  eligible: boolean
  emailVerified: boolean
  phoneVerified: boolean
  barred: boolean
  reason: string | null
}

/** Whether a customer may bid right now. */
export const checkEligibility = async (
  container: MedusaContainer,
  customerId: string
): Promise<Eligibility> => {
  const svc: any = container.resolve(AUCTION_MODULE)
  const [row] = await svc.listBidderEligibilities({ customer_id: customerId }, { take: 1 })

  const emailVerified = !!row?.email_verified_at
  const phoneVerified = !!row?.phone_verified_at
  const barred = !!row?.is_barred

  if (barred) {
    return {
      eligible: false,
      emailVerified,
      phoneVerified,
      barred,
      reason:
        row?.barred_reason ||
        "Your account can't place bids. Contact support if you think this is a mistake.",
    }
  }

  if (!emailVerified || !phoneVerified) {
    return {
      eligible: false,
      emailVerified,
      phoneVerified,
      barred,
      reason: !phoneVerified
        ? "Verify your phone number before bidding."
        : "Verify your email address before bidding.",
    }
  }

  return { eligible: true, emailVerified, phoneVerified, barred, reason: null }
}

export const assertEligible = async (
  container: MedusaContainer,
  customerId: string
): Promise<void> => {
  const result = await checkEligibility(container, customerId)
  if (result.eligible) return
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    result.reason ?? "You're not eligible to bid yet."
  )
}

/**
 * Send a phone verification code.
 *
 * Rate-limited per customer. Resending before the cooldown returns quietly
 * rather than erroring — a customer tapping "resend" twice should not see a
 * failure, and the cooldown is about protecting the SMS bill, not about
 * scolding them.
 */
export const sendPhoneOtp = async (
  container: MedusaContainer,
  args: { customerId: string; phone: string; email?: string | null }
): Promise<{ sent: boolean; phone: string; retryAfterSeconds: number }> => {
  const phone = normaliseNigerianPhone(args.phone)
  if (!phone) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "That doesn't look like a Nigerian mobile number."
    )
  }

  const svc: any = container.resolve(AUCTION_MODULE)
  const now = new Date()

  let [row] = await svc.listBidderEligibilities(
    { customer_id: args.customerId },
    { take: 1 }
  )

  if (row?.phone_otp_sent_at) {
    const elapsed = (now.getTime() - new Date(row.phone_otp_sent_at).getTime()) / 1000
    if (elapsed < OTP_RESEND_SECONDS) {
      return {
        sent: false,
        phone,
        retryAfterSeconds: Math.ceil(OTP_RESEND_SECONDS - elapsed),
      }
    }
  }

  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0")
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000)

  const patch = {
    phone,
    phone_otp_hash: hashOtp(code, args.customerId),
    phone_otp_expires_at: expiresAt,
    phone_otp_attempts: 0,
    phone_otp_sent_at: now,
    // Changing the number invalidates any previous verification.
    phone_verified_at: row?.phone === phone ? row?.phone_verified_at ?? null : null,
  }

  if (row) {
    await svc.updateBidderEligibilities({ id: row.id, ...patch })
  } else {
    row = await svc.createBidderEligibilities({
      customer_id: args.customerId,
      email: args.email ?? null,
      ...patch,
    })
  }

  await sendNotification(container, {
    to: phone,
    channel: "sms",
    template: "bidder-otp",
    triggerType: "auction.otp_sent",
    resourceId: args.customerId,
    resourceType: "bidder_eligibility",
    content: {
      text: `${code} is your Ceedmart verification code. It expires in ${OTP_TTL_MINUTES} minutes.`,
    },
  })

  return { sent: true, phone, retryAfterSeconds: OTP_RESEND_SECONDS }
}

/**
 * Check a submitted code.
 *
 * Attempts are counted and capped: without a cap, a six-digit code is
 * guessable by anyone willing to send a million requests. Exhausting the
 * attempts clears the code entirely, so brute force costs a fresh SMS and
 * a fresh cooldown each time.
 */
export const verifyPhoneOtp = async (
  container: MedusaContainer,
  args: { customerId: string; code: string }
): Promise<{ verified: boolean; message?: string }> => {
  const svc: any = container.resolve(AUCTION_MODULE)
  const now = new Date()

  const [row] = await svc.listBidderEligibilities(
    { customer_id: args.customerId },
    { take: 1 }
  )

  if (!row?.phone_otp_hash) {
    return { verified: false, message: "Request a code first." }
  }

  if (row.phone_otp_expires_at && new Date(row.phone_otp_expires_at) <= now) {
    return { verified: false, message: "That code has expired. Request a new one." }
  }

  if ((row.phone_otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    return {
      verified: false,
      message: "Too many attempts. Request a new code.",
    }
  }

  const submitted = hashOtp((args.code || "").trim(), args.customerId)

  if (!constantTimeEquals(submitted, row.phone_otp_hash)) {
    const attempts = (row.phone_otp_attempts ?? 0) + 1
    await svc.updateBidderEligibilities({
      id: row.id,
      phone_otp_attempts: attempts,
      // Burn the code once the cap is reached.
      ...(attempts >= OTP_MAX_ATTEMPTS
        ? { phone_otp_hash: null, phone_otp_expires_at: null }
        : {}),
    })
    return {
      verified: false,
      message:
        attempts >= OTP_MAX_ATTEMPTS
          ? "Too many attempts. Request a new code."
          : "That code isn't right.",
    }
  }

  await svc.updateBidderEligibilities({
    id: row.id,
    phone_verified_at: now,
    phone_otp_hash: null,
    phone_otp_expires_at: null,
    phone_otp_attempts: 0,
  })

  return { verified: true }
}

/**
 * Record that an email is verified.
 *
 * Pulse Identity owns email verification for customer accounts, so this
 * mirrors its outcome rather than running a second flow — one verification,
 * recorded where the bid path can read it cheaply.
 */
export const markEmailVerified = async (
  container: MedusaContainer,
  args: { customerId: string; email: string }
): Promise<void> => {
  const svc: any = container.resolve(AUCTION_MODULE)
  const [row] = await svc.listBidderEligibilities(
    { customer_id: args.customerId },
    { take: 1 }
  )

  if (row) {
    await svc.updateBidderEligibilities({
      id: row.id,
      email: args.email,
      email_verified_at: new Date(),
    })
    return
  }

  await svc.createBidderEligibilities({
    customer_id: args.customerId,
    email: args.email,
    email_verified_at: new Date(),
  })
}
