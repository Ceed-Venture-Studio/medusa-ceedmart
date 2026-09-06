import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../../../modules/auction"
import { actorFromRequest } from "../../../../../../lib/state-machine"
import { auctionMachine } from "../../../../../../lib/state-machine/machines"

// Release or forfeit a bidder's deposit by hand (BRD §8.9).
//
// The jobs handle the ordinary cases — losing bidders are released at
// close, a defaulting winner's deposit is forfeited when the payment
// window lapses. This is for the ones a human has to decide: a bidder who
// got in touch, a default we're waiving, a dispute settled in the
// customer's favour.
//
// Forfeiting demands a reason. §8.9 permits retaining "a disclosed
// penalty", and a retention with no recorded justification is not a
// penalty — it is money we kept.
//
// Nothing here charges anyone. A deposit is an authorisation; releasing it
// lifts the hold and forfeiting it retains an amount already authorised.

type Body = { action: "release" | "forfeit"; reason?: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id, deposit_id } = req.params
  const action = req.body?.action
  const actor = actorFromRequest(req)

  if (action !== "release" && action !== "forfeit") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "action must be release or forfeit"
    )
  }

  if (action === "forfeit" && !req.body?.reason?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Forfeiting a deposit requires a reason the bidder can be shown."
    )
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const deposit = await svc.retrieveBidderDeposit(deposit_id).catch(() => null)
  if (!deposit || deposit.auction_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Deposit ${deposit_id} was not found on this auction`
    )
  }

  if (deposit.status !== "authorized") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `This deposit is already ${deposit.status}.`
    )
  }

  const now = new Date()
  const updated = await svc.updateBidderDeposits(
    action === "release"
      ? { id: deposit_id, status: "released", released_at: now }
      : {
          id: deposit_id,
          status: "forfeited",
          forfeited_at: now,
          forfeit_reason: req.body?.reason?.trim(),
        }
  )

  await auctionMachine.record(req.scope, {
    entityId: id,
    action: `deposit.${action}d`,
    actor,
    fromValue: "authorized",
    toValue: action === "release" ? "released" : "forfeited",
    reason: req.body?.reason?.trim() ?? null,
    correlationId: id,
    metadata: {
      deposit_id,
      bidder_id: deposit.bidder_id,
      amount: Number(deposit.amount),
    },
  })

  res.json({ deposit: Array.isArray(updated) ? updated[0] : updated })
}
