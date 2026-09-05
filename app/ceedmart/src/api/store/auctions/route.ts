import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AUCTION_MODULE } from "../../../modules/auction"
import { FEATURE_FLAGS, assertEnabled } from "../../../lib/feature-flags"

// Public auction listing (BRD §8.11, §9.1).
//
// "Customers can distinguish upcoming, live, ended and cancelled auctions."
// Drafts are never listed — an unpublished auction does not exist as far as
// the storefront is concerned.

const PUBLIC_STATUSES = [
  "scheduled",
  "live",
  "ended",
  "awaiting_winner_payment",
  "reserve_not_met",
  "paid",
  "fulfilment",
  "completed",
  "cancelled",
]

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  assertEnabled(FEATURE_FLAGS.AUCTION)

  const svc: any = req.scope.resolve(AUCTION_MODULE)
  const now = new Date()

  const requested =
    typeof req.query.status === "string" && req.query.status
      ? req.query.status.split(",").filter((s) => PUBLIC_STATUSES.includes(s))
      : PUBLIC_STATUSES

  const auctions = await svc.listAuctions(
    { status: requested },
    { order: { ends_at: "ASC" }, take: Number(req.query.limit) || 50 }
  )

  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30")

  res.json({
    auctions: (auctions as any[]).map((a) => ({
      id: a.id,
      reference: a.reference,
      title: a.title,
      description: a.description,
      images: a.images ?? [],
      condition: a.condition,
      status: a.status,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      seconds_remaining: Math.max(
        0,
        Math.floor((new Date(a.ends_at).getTime() - now.getTime()) / 1000)
      ),
      starting_price: Number(a.starting_price),
      current_price: a.current_price === null ? null : Number(a.current_price),
      buy_now_price: a.buy_now_price === null ? null : Number(a.buy_now_price),
      currency_code: a.currency_code,
      bid_count: a.bid_count,
      // §8.4 — the reserve itself stays hidden.
      has_reserve: a.reserve_price !== null,
      reserve_met:
        a.reserve_price === null
          ? true
          : Number(a.current_price ?? 0) >= Number(a.reserve_price),
    })),
    server_time: now.toISOString(),
  })
}
