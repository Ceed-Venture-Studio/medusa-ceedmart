import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AUCTION_MODULE } from "../../../modules/auction"
import { LISTING_POLICY_MODULE } from "../../../modules/listing-policy"
import { generateReference } from "../../../lib/build/quotes"
import { actorFromRequest } from "../../../lib/state-machine"
import { auctionMachine } from "../../../lib/state-machine/machines"

// Auction creation and listing (BRD §8.4).
//
// "Draft auctions require validation and a preview before publication." So
// creation always produces a DRAFT, and publishing is a separate, validated
// step — an auction goes live because someone checked it, not because they
// filled in a form.

type Body = {
  title: string
  description?: string
  product_id?: string
  variant_id?: string
  inventory_item_id?: string
  stock_location_id?: string
  unit_reference?: string
  condition?: string
  condition_report?: string
  known_defects?: string[]
  images?: string[]
  inspection_details?: string
  starts_at: string
  ends_at: string
  starting_price: number
  min_increment: number
  reserve_price?: number
  buy_now_price?: number
  deposit_amount?: number
  antisnipe_window_seconds?: number
  antisnipe_extension_seconds?: number
  max_bids_per_bidder?: number
  payment_window_hours?: number
  return_policy_text?: string
  warranty_text?: string
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(AUCTION_MODULE)

  const filters: Record<string, unknown> = {}
  if (typeof req.query.status === "string" && req.query.status) {
    filters.status = req.query.status.split(",")
  }

  const auctions = await svc.listAuctions(filters, {
    order: { created_at: "DESC" },
    take: Number(req.query.limit) || 50,
  })

  // Attach the result for closed auctions so the list can show outcomes
  // without a request per row.
  const ids = (auctions as any[]).map((a) => a.id)
  const results = ids.length
    ? await svc.listAuctionResults({ auction_id: ids }, { take: 200 })
    : []
  const byAuction = new Map<string, any>(
    (results as any[]).map((r) => [r.auction_id, r])
  )

  res.json({
    auctions: (auctions as any[]).map((a) => ({
      ...a,
      starting_price: Number(a.starting_price),
      current_price: a.current_price === null ? null : Number(a.current_price),
      reserve_price: a.reserve_price === null ? null : Number(a.reserve_price),
      result: byAuction.get(a.id) ?? null,
    })),
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const body = req.body || ({} as Body)

  if (!body.title?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "title is required")
  }

  const startsAt = new Date(body.starts_at)
  const endsAt = new Date(body.ends_at)

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "starts_at and ends_at must be valid timestamps"
    )
  }
  if (endsAt <= startsAt) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The auction must end after it starts"
    )
  }

  const startingPrice = Math.round(Number(body.starting_price))
  const increment = Math.round(Number(body.min_increment))

  if (!Number.isFinite(startingPrice) || startingPrice < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "starting_price must be a non-negative amount in kobo"
    )
  }
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "min_increment must be a positive amount in kobo"
    )
  }

  // A Buy Now below the starting price would let someone skip the auction
  // for less than its opening bid.
  if (body.buy_now_price != null && Number(body.buy_now_price) <= startingPrice) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "buy_now_price must be above the starting price"
    )
  }

  const svc: any = req.scope.resolve(AUCTION_MODULE)

  const auction = await svc.createAuctions({
    reference: generateReference("AU"),
    title: body.title.trim(),
    description: body.description ?? null,
    product_id: body.product_id ?? null,
    variant_id: body.variant_id ?? null,
    inventory_item_id: body.inventory_item_id ?? null,
    stock_location_id: body.stock_location_id ?? null,
    unit_reference: body.unit_reference ?? null,
    condition: body.condition ?? "used",
    condition_report: body.condition_report ?? null,
    known_defects: body.known_defects ?? null,
    images: body.images ?? null,
    inspection_details: body.inspection_details ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    original_ends_at: endsAt,
    starting_price: startingPrice,
    min_increment: increment,
    reserve_price:
      body.reserve_price == null ? null : Math.round(Number(body.reserve_price)),
    buy_now_price:
      body.buy_now_price == null ? null : Math.round(Number(body.buy_now_price)),
    deposit_amount:
      body.deposit_amount == null ? null : Math.round(Number(body.deposit_amount)),
    antisnipe_window_seconds: body.antisnipe_window_seconds ?? 300,
    antisnipe_extension_seconds: body.antisnipe_extension_seconds ?? 300,
    max_bids_per_bidder: body.max_bids_per_bidder ?? null,
    payment_window_hours: body.payment_window_hours ?? 24,
    return_policy_text: body.return_policy_text ?? null,
    warranty_text: body.warranty_text ?? null,
    // §8.4 — always a draft. Publishing is a separate, validated step.
    status: "draft",
  })

  await auctionMachine.record(req.scope, {
    entityId: auction.id,
    action: "auction.created",
    actor: actorFromRequest(req),
    metadata: { reference: auction.reference, title: auction.title },
  })

  res.status(201).json({ auction })
}
