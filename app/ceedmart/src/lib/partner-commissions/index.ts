import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { PARTNER_MODULE } from "../../modules/partner"
import { COMMISSION_ENTRY_MODULE } from "../../modules/commission-entry"

// M3 — Partner referral accrual helpers. Shared by the three subscriber
// files (partner-commission-accrue.ts, partner-commission-earn.ts,
// partner-commission-reverse.ts) so the accrual logic lives in one place.
//
// Lifecycle:
//   order.placed     → PENDING  (accrue at partner's rate at snapshot time)
//   order.completed  → EARNED   (spec §2 verified state — paid + delivered)
//   order.canceled   → REVERSED (post negative-amount entry; original row
//                                also flipped so period sums net out)
//
// Idempotent — retries look up existing entries before writing.
// Eligible basis (spec §9.11): "subtotal_ex_tax" by default; overridable
// via PARTNER_COMMISSION_BASIS env.

const BASIS_ENV = "PARTNER_COMMISSION_BASIS"
export type Basis = "subtotal_ex_tax" | "subtotal" | "total"
const DEFAULT_BASIS: Basis = "subtotal_ex_tax"

type Ctx = {
  logger: Logger
  query: any
  partners: any
  entries: any
}

const asNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (v && typeof v === "object" && "value" in (v as any)) {
    const n = Number((v as any).value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function resolveBasis(): Basis {
  const raw = (process.env[BASIS_ENV] || "").trim() as Basis
  if (raw === "subtotal" || raw === "total" || raw === "subtotal_ex_tax") return raw
  return DEFAULT_BASIS
}

function computeEligibleAmount(order: any, basis: Basis): number {
  if (basis === "total") return asNumber(order.total)
  if (basis === "subtotal") return asNumber(order.subtotal) + asNumber(order.tax_total)
  return asNumber(order.subtotal)
}

function extractPartnerCode(order: any): string | null {
  const meta = order.metadata as any
  const code = meta?.ceedmart?.partner_code
  return typeof code === "string" && code.trim() ? code.trim() : null
}

function makeCtx(container: MedusaContainer): Ctx {
  return {
    logger: container.resolve(ContainerRegistrationKeys.LOGGER),
    query: container.resolve(ContainerRegistrationKeys.QUERY),
    partners: container.resolve(PARTNER_MODULE),
    entries: container.resolve(COMMISSION_ENTRY_MODULE),
  }
}

async function loadOrder(ctx: Ctx, orderId: string) {
  const { data: orders } = await ctx.query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "subtotal",
      "tax_total",
      "total",
      "metadata",
    ],
    filters: { id: orderId },
  })
  return (orders as any[])[0] ?? null
}

async function findPartnerByCode(ctx: Ctx, code: string) {
  const rows = await ctx.partners.listPartners(
    { code, status: "active" },
    { take: 1 }
  )
  return (rows as any[])[0] ?? null
}

async function findActiveEntries(ctx: Ctx, orderId: string, statuses: string[]) {
  return (await ctx.entries.listCommissionEntries(
    { order_id: orderId, status: statuses },
    { take: 10 }
  )) as any[]
}

export async function accrueForOrderPlaced(
  container: MedusaContainer,
  orderId: string
): Promise<void> {
  const ctx = makeCtx(container)
  try {
    const order = await loadOrder(ctx, orderId)
    if (!order) return

    const code = extractPartnerCode(order)
    if (!code) return

    const existing = await findActiveEntries(ctx, order.id, ["pending", "earned"])
    if (existing.length) return

    const partner = await findPartnerByCode(ctx, code)
    if (!partner) {
      ctx.logger.warn(
        `[partner-commissions] Order ${order.display_id ?? order.id} carries unknown partner code "${code}"`
      )
      return
    }

    const basis = resolveBasis()
    const eligibleAmount = computeEligibleAmount(order, basis)
    if (eligibleAmount <= 0) return

    const rate = asNumber(partner.commission_rate) || 0.07
    const commissionAmount = Math.round(eligibleAmount * rate * 100) / 100

    await ctx.entries.createCommissionEntries({
      partner_id: partner.id,
      partner_code: partner.code,
      order_id: order.id,
      order_display_id: order.display_id ?? null,
      eligible_amount: eligibleAmount,
      eligible_basis: basis,
      currency_code: order.currency_code,
      commission_rate: rate,
      commission_amount: commissionAmount,
      status: "pending",
      reason: "order_placed",
    })

    ctx.logger.info(
      `[partner-commissions] Accrued ${rate * 100}% × ${eligibleAmount} = ${commissionAmount} ${order.currency_code} to ${partner.code} for order ${order.display_id ?? order.id}`
    )
  } catch (err: any) {
    ctx.logger.error(`[partner-commissions] accrue ${orderId}: ${err?.message ?? err}`)
  }
}

export async function markCompletedForOrder(
  container: MedusaContainer,
  orderId: string,
  event: string
): Promise<void> {
  const ctx = makeCtx(container)
  try {
    const rows = await findActiveEntries(ctx, orderId, ["pending"])
    for (const row of rows) {
      await ctx.entries.updateCommissionEntries({ id: row.id, status: "earned" })
      ctx.logger.info(
        `[partner-commissions] ${event} → EARNED entry ${row.id} (partner ${row.partner_code})`
      )
    }
  } catch (err: any) {
    ctx.logger.error(`[partner-commissions] ${event} ${orderId}: ${err?.message ?? err}`)
  }
}

export async function reverseForOrder(
  container: MedusaContainer,
  orderId: string,
  event: string
): Promise<void> {
  const ctx = makeCtx(container)
  try {
    const rows = await findActiveEntries(ctx, orderId, ["pending", "earned"])
    for (const row of rows) {
      await ctx.entries.updateCommissionEntries({ id: row.id, status: "reversed" })
      const negativeAmount = -asNumber(row.commission_amount)
      const negativeEligible = -asNumber(row.eligible_amount)
      await ctx.entries.createCommissionEntries({
        partner_id: row.partner_id,
        partner_code: row.partner_code,
        order_id: row.order_id,
        order_display_id: row.order_display_id,
        eligible_amount: negativeEligible,
        eligible_basis: row.eligible_basis,
        currency_code: row.currency_code,
        commission_rate: row.commission_rate,
        commission_amount: negativeAmount,
        status: "reversed",
        reason: event,
        metadata: { reverses: row.id },
      })
      ctx.logger.info(
        `[partner-commissions] ${event} → REVERSED entry ${row.id} (posted counter ${negativeAmount})`
      )
    }
  } catch (err: any) {
    ctx.logger.error(`[partner-commissions] ${event} ${orderId}: ${err?.message ?? err}`)
  }
}
