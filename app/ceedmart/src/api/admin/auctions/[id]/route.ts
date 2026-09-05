import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../../modules/auction"
import { LISTING_POLICY_MODULE } from "../../../../modules/listing-policy"
import { actorFromRequest } from "../../../../lib/state-machine"
import { auctionMachine } from "../../../../lib/state-machine/machines"
import { offerToNextBidder } from "../../../../lib/auction/settle"

// Publish, edit, cancel and progress an auction (BRD §8.4, §8.5, §8.10).

type Body = {
  action?: "publish" | "cancel" | "relist" | "offer_next" | "transition"
  status?: string
  reason?: string
  // Editable draft fields.
  title?: string
  description?: string
  condition_report?: string
  starts_at?: string
  ends_at?: string
  reserve_price?: number
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(req.params.id).catch(() => null)

  if (!auction) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Auction ${req.params.id} was not found`
    )
  }

  const [bids, result, offers, deposits, disputes] = await Promise.all([
    svc.listBids({ auction_id: auction.id }, { order: { sequence: "DESC" }, take: 200 }),
    svc.listAuctionResults({ auction_id: auction.id }, { take: 1 }),
    svc.listWinnerOffers({ auction_id: auction.id }, { order: { rank: "ASC" }, take: 20 }),
    svc.listBidderDeposits({ auction_id: auction.id }, { take: 200 }),
    svc.listAuctionDisputes({ auction_id: auction.id }, { take: 50 }),
  ])

  // Admin sees real bidder ids — §8.6 masks the CUSTOMER-visible history,
  // not the operational view support needs to resolve a dispute.
  res.json({
    auction,
    bids,
    result: (result as any[])[0] ?? null,
    offers,
    deposits,
    disputes,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.body || ({} as Body)
  const actor = actorFromRequest(req)

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const auction = await svc.retrieveAuction(id).catch(() => null)
  if (!auction) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Auction ${id} was not found`
    )
  }

  // ── Publish ───────────────────────────────────────────────────────
  if (body.action === "publish") {
    // §8.4 — validation before publication. These are the facts a bidder
    // needs to bid responsibly, so an auction without them cannot go live.
    const problems: string[] = []
    if (!auction.inventory_item_id && !auction.variant_id) {
      problems.push("no item is attached")
    }
    if (!auction.condition_report) {
      problems.push("the condition report is empty")
    }
    if (new Date(auction.ends_at) <= new Date()) {
      problems.push("the end time is in the past")
    }
    if (Number(auction.min_increment) <= 0) {
      problems.push("the bid increment must be positive")
    }

    if (problems.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `This auction isn't ready to publish: ${problems.join("; ")}.`
      )
    }

    await auctionMachine.transition(req.scope, {
      entityId: id,
      from: auction.status,
      to: "scheduled",
      actor,
      correlationId: id,
    })
    await svc.updateAuctions({ id, status: "scheduled" })

    // §8.11 — the unit cannot be sold through another checkout while the
    // auction runs. The listing policy is what the cart consults.
    if (auction.variant_id) {
      const policies: any = req.scope.resolve(LISTING_POLICY_MODULE)
      const [existing] = await policies.listListingPolicies(
        { variant_id: auction.variant_id },
        { take: 1 }
      )
      const payload = {
        commerce_type: "auction",
        is_active: true,
        reference_id: id,
        config: { reference: auction.reference, ends_at: auction.ends_at },
      }
      if (existing) {
        await policies.updateListingPolicies({ id: existing.id, ...payload })
      } else {
        await policies.createListingPolicies({
          variant_id: auction.variant_id,
          ...payload,
        })
      }
    }

    res.json({ auction: { ...auction, status: "scheduled" } })
    return
  }

  // ── Cancel ────────────────────────────────────────────────────────
  if (body.action === "cancel") {
    // §8.10 — cancelling after bidding begins requires elevated permission
    // and a reason visible in the audit log. The state machine already
    // demands the reason; this makes the consequence explicit.
    if (!body.reason?.trim()) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cancelling an auction requires a reason, which bidders will be told."
      )
    }

    await auctionMachine.transition(req.scope, {
      entityId: id,
      from: auction.status,
      to: "cancelled",
      actor,
      reason: body.reason,
      correlationId: id,
      metadata: { bid_count: auction.bid_count },
    })

    await svc.updateAuctions({
      id,
      status: "cancelled",
      cancellation_reason: body.reason,
    })

    // Release every hold — nobody should have funds tied up in an auction
    // we cancelled.
    const deposits = await svc.listBidderDeposits(
      { auction_id: id, status: "authorized" },
      { take: 500 }
    )
    for (const deposit of deposits as any[]) {
      await svc.updateBidderDeposits({
        id: deposit.id,
        status: "released",
        released_at: new Date(),
      })
    }

    // Return the unit to ordinary stock.
    if (auction.variant_id) {
      const policies: any = req.scope.resolve(LISTING_POLICY_MODULE)
      const [existing] = await policies.listListingPolicies(
        { variant_id: auction.variant_id },
        { take: 1 }
      )
      if (existing?.reference_id === id) {
        await policies.deleteListingPolicies(existing.id)
      }
    }

    res.json({ auction: { ...auction, status: "cancelled" } })
    return
  }

  // ── Offer to the next bidder ──────────────────────────────────────
  if (body.action === "offer_next") {
    const offer = await offerToNextBidder(req.scope, id)
    if (!offer) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "There's no eligible bidder left to offer this to. Relist it instead."
      )
    }

    if (auctionMachine.canTransition(auction.status, "offered_to_next_bidder")) {
      await auctionMachine.transition(req.scope, {
        entityId: id,
        from: auction.status,
        to: "offered_to_next_bidder",
        actor,
        reason: body.reason ?? "Offered to the next eligible bidder",
        correlationId: id,
      })
      await svc.updateAuctions({ id, status: "offered_to_next_bidder" })
    }

    res.json({ offer })
    return
  }

  // ── Generic transition ────────────────────────────────────────────
  if (body.action === "transition" && body.status) {
    await auctionMachine.transition(req.scope, {
      entityId: id,
      from: auction.status,
      to: body.status,
      actor,
      reason: body.reason,
      correlationId: id,
    })
    await svc.updateAuctions({ id, status: body.status })

    res.json({ auction: { ...auction, status: body.status } })
    return
  }

  // ── Edit ──────────────────────────────────────────────────────────
  // §8.10 — "material item-description edits after the first bid should
  // require auction cancellation and relisting." Editing what an item IS
  // after people have bid on it changes what they bid on.
  const materialFields = ["title", "description", "condition_report", "reserve_price"]
  const editing = Object.keys(body).filter((k) => materialFields.includes(k))

  if (editing.length && Number(auction.bid_count) > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This auction already has bids. Material changes need it cancelled and relisted, so bidders aren't held to a description they never saw."
    )
  }

  const update: Record<string, any> = { id }
  for (const field of editing) update[field] = (body as any)[field]
  if (body.starts_at) update.starts_at = new Date(body.starts_at)
  if (body.ends_at) {
    update.ends_at = new Date(body.ends_at)
    update.original_ends_at = new Date(body.ends_at)
  }

  if (Object.keys(update).length === 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Nothing to update"
    )
  }

  const updated = await svc.updateAuctions(update)

  await auctionMachine.record(req.scope, {
    entityId: id,
    action: "auction.updated",
    actor,
    changes: { fields: Object.keys(update).filter((k) => k !== "id") },
  })

  res.json({ auction: Array.isArray(updated) ? updated[0] : updated })
}
