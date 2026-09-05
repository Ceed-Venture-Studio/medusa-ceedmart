import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../modules/auction"
import { assertEligible } from "../../../../../lib/auction/eligibility"
import { auctionMachine } from "../../../../../lib/state-machine/machines"
import { FEATURE_FLAGS, assertEnabled } from "../../../../../lib/feature-flags"

// Place a refundable bidder deposit / payment-method hold (BRD §8.2, D-10).
//
// ── Authorise, don't capture ────────────────────────────────────────────
// A deposit is a HOLD. The money stays with the bidder unless they win and
// default. §8.8 requires losing bidders' holds be released after close, and
// §8.9 permits retaining a disclosed deposit only from a defaulting winner.
//
// So this records an authorisation, never a capture. `authorization_reference`
// and `capture_reference` are separate columns precisely so a hold can never
// be mistaken for money we took.
//
// The gateway call itself is left to the payment provider integration; this
// records the outcome and is the single place the auction flow consults.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null
  if (!customerId) {
    res.json({ deposit: null, required: false })
    return
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(req.params.id).catch(() => null)
  if (!auction) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This auction was not found.")
  }

  const [deposit] = await svc.listBidderDeposits(
    { auction_id: req.params.id, bidder_id: customerId },
    { take: 1 }
  )

  res.json({
    required: auction.deposit_amount !== null,
    amount: auction.deposit_amount === null ? null : Number(auction.deposit_amount),
    currency_code: auction.currency_code,
    deposit: deposit
      ? {
          status: deposit.status,
          amount: Number(deposit.amount),
          authorized_at: deposit.authorized_at,
        }
      : null,
  })
}

type Body = { authorization_reference: string }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const auth = (req as any).auth_context
  const customerId = auth?.actor_type === "customer" ? auth.actor_id : null
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Sign in to place a deposit."
    )
  }

  await assertEligible(req.scope, customerId)

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(req.params.id).catch(() => null)
  if (!auction) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This auction was not found.")
  }

  if (auction.deposit_amount === null) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This auction doesn't require a deposit."
    )
  }

  if (!req.body?.authorization_reference?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A payment authorisation reference is required."
    )
  }

  const [existing] = await svc.listBidderDeposits(
    { auction_id: req.params.id, bidder_id: customerId },
    { take: 1 }
  )

  // Idempotent — a retried request must not stack two holds on one bidder.
  if (existing) {
    res.json({ deposit: { status: existing.status, amount: Number(existing.amount) } })
    return
  }

  const deposit = await svc.createBidderDeposits({
    auction_id: req.params.id,
    bidder_id: customerId,
    amount: Number(auction.deposit_amount),
    currency_code: auction.currency_code ?? "ngn",
    status: "authorized",
    authorization_reference: req.body.authorization_reference.trim(),
    authorized_at: new Date(),
  })

  await auctionMachine.record(req.scope, {
    entityId: req.params.id,
    action: "deposit.authorized",
    actor: { type: "customer", id: customerId },
    correlationId: req.params.id,
    metadata: { amount: Number(auction.deposit_amount) },
  })

  res.status(201).json({
    deposit: { status: deposit.status, amount: Number(deposit.amount) },
  })
}
