import type { Knex } from "@medusajs/framework/mikro-orm/knex"

// The till's order list.
//
// /admin/orders can't serve it. getOrdersListWorkflow always loads every
// order's full items (it needs them to work out the statuses), whatever
// `fields` asks for, so a page costs ~8 KB per order. And fulfillment_status
// is computed in JS after the query, so it can't be filtered on: the till
// used to download 500 orders to filter and page locally, plus every order
// in the store to count the unfulfilled ones for the sidebar badge (~20 MB,
// which a shop's mobile connection often can't finish in time).
//
// Here the filtering, paging and counting happen in SQL, and only one page
// of orders goes through the workflow. FULFILLMENT_STATUS_SQL mirrors
// getLastFulfillmentStatus in core-flows/order/utils/aggregate-status.ts;
// keep the two in step.

export const FULFILLMENT_STATUSES = [
  "not_fulfilled",
  "partially_fulfilled",
  "fulfilled",
  "partially_shipped",
  "shipped",
  "partially_delivered",
  "delivered",
  "canceled",
] as const

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

export type PosOrderListFilters = {
  q?: string
  sales_channel_id?: string
  fulfillment_status?: FulfillmentStatus
}

// Per order: its fulfillments bucketed the way aggregate-status buckets them
// (canceled_at wins, then delivered_at, shipped_at, packed_at), and whether
// any item at the current version is still short of its quantity.
const FULFILLMENT_COUNTS_SQL = `
  select ofl.order_id,
         count(*) as total,
         count(*) filter (where fu.canceled_at is not null) as canceled,
         count(*) filter (where fu.canceled_at is null and fu.delivered_at is not null) as delivered,
         count(*) filter (where fu.canceled_at is null and fu.delivered_at is null
                            and fu.shipped_at is not null) as shipped,
         count(*) filter (where fu.canceled_at is null and fu.delivered_at is null
                            and fu.shipped_at is null and fu.packed_at is not null) as packed
    from order_fulfillment ofl
    join fulfillment fu on fu.id = ofl.fulfillment_id and fu.deleted_at is null
   where ofl.deleted_at is null
   group by ofl.order_id`

const UNFULFILLED_ITEMS_SQL = `exists (
  select 1 from order_item oi
   where oi.order_id = o.id and oi.version = o.version and oi.deleted_at is null
     and oi.fulfilled_quantity < oi.quantity)`

const FULFILLMENT_STATUS_SQL = `case
  when coalesce(f.delivered, 0) > 0 then
    case when f.delivered = f.total - f.canceled and not ${UNFULFILLED_ITEMS_SQL}
         then 'delivered' else 'partially_delivered' end
  when coalesce(f.shipped, 0) > 0 then
    case when f.shipped = f.total - f.canceled and not ${UNFULFILLED_ITEMS_SQL}
         then 'shipped' else 'partially_shipped' end
  when coalesce(f.packed, 0) > 0 then
    case when f.packed = f.total - f.canceled and not ${UNFULFILLED_ITEMS_SQL}
         then 'fulfilled' else 'partially_fulfilled' end
  when coalesce(f.canceled, 0) > 0 and f.canceled = f.total then 'canceled'
  else 'not_fulfilled'
end`

// Orders as /admin/orders lists them (no drafts), with their computed
// fulfillment status, narrowed by the till's search and channel filters.
export const ordersWithStatus = (knex: Knex, filters: PosOrderListFilters) => {
  const query = knex
    .select(
      "o.id",
      "o.created_at",
      "o.status",
      knex.raw(`${FULFILLMENT_STATUS_SQL} as fulfillment_status`)
    )
    .from({ o: "order" })
    .leftJoin(knex.raw(`(${FULFILLMENT_COUNTS_SQL}) as f`), "f.order_id", "o.id")
    .whereNull("o.deleted_at")
    .where("o.is_draft_order", false)

  if (filters.sales_channel_id) {
    query.where("o.sales_channel_id", filters.sales_channel_id)
  }

  const q = filters.q?.trim().replace(/^#/, "")
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    query.where((w) => {
      w.whereILike("o.email", like).orWhereILike("o.custom_display_id", like)
      if (/^\d{1,9}$/.test(q)) {
        w.orWhere("o.display_id", Number(q))
      }
    })
  }

  return query
}

/**
 * One page of order ids, newest first, plus the total matching the filters.
 */
export const listPosOrderIds = async (
  knex: Knex,
  filters: PosOrderListFilters,
  page: { limit: number; offset: number }
): Promise<{ ids: string[]; count: number }> => {
  const rows: { id: string; count: string }[] = await knex
    .select("s.id", knex.raw("count(*) over () as count"))
    .from(ordersWithStatus(knex, filters).as("s"))
    .modify((qb) => {
      if (filters.fulfillment_status) {
        qb.where("s.fulfillment_status", filters.fulfillment_status)
      }
    })
    .orderBy("s.created_at", "desc")
    .orderBy("s.id", "desc")
    .limit(page.limit)
    .offset(page.offset)

  if (rows.length) {
    return { ids: rows.map((r) => r.id), count: Number(rows[0].count) }
  }
  if (page.offset === 0) {
    return { ids: [], count: 0 }
  }
  // Paged past the end: count(*) over () has no row to ride on.
  const [{ count }] = await knex
    .count({ count: "*" })
    .from(ordersWithStatus(knex, filters).as("s"))
    .modify((qb) => {
      if (filters.fulfillment_status) {
        qb.where("s.fulfillment_status", filters.fulfillment_status)
      }
    })
  return { ids: [], count: Number(count) }
}

/**
 * Orders still waiting to be fulfilled, for the till's sidebar badge.
 * Canceled orders need no action, so they don't count.
 */
export const countUnfulfilledOrders = async (knex: Knex): Promise<number> => {
  const [{ count }] = (await knex
    .count({ count: "*" })
    .from(ordersWithStatus(knex, {}).as("s"))
    .where("s.fulfillment_status", "not_fulfilled")
    .whereNot("s.status", "canceled")) as { count: string | number }[]
  return Number(count)
}

type WorkflowOrder = {
  id: string
  display_id: number
  custom_display_id?: string | null
  created_at: string | Date
  status: string
  payment_status: string
  fulfillment_status: string
  total: unknown
  currency_code: string
  email?: string | null
  customer?: { email?: string | null } | null
  sales_channel?: { id: string; name: string } | null
  shipping_methods?: { name?: string | null; shipping_option_id?: string | null }[] | null
}

export const POS_ORDER_LIST_FIELDS = [
  "id",
  "display_id",
  "custom_display_id",
  "created_at",
  "status",
  "total",
  "currency_code",
  "email",
  "customer.email",
  "sales_channel.id",
  "sales_channel.name",
  "shipping_methods.name",
  "shipping_methods.shipping_option_id",
]

/**
 * What a row of the till's order table needs — and nothing else, so the
 * items the workflow had to load don't travel.
 */
export const toPosOrderRow = (order: WorkflowOrder) => ({
  id: order.id,
  display_id: order.display_id,
  custom_display_id: order.custom_display_id ?? null,
  created_at: order.created_at,
  status: order.status,
  payment_status: order.payment_status,
  fulfillment_status: order.fulfillment_status,
  total: Number(order.total ?? 0),
  currency_code: order.currency_code,
  customer: { email: order.customer?.email ?? order.email ?? null },
  sales_channel: order.sales_channel
    ? { id: order.sales_channel.id, name: order.sales_channel.name }
    : null,
  shipping_methods: (order.shipping_methods ?? []).map((m) => ({
    name: m.name ?? null,
    shipping_option_id: m.shipping_option_id ?? null,
  })),
})

export type PosOrderRow = ReturnType<typeof toPosOrderRow>

/**
 * Put the workflow's orders back in the SQL page's order.
 */
export const inIdOrder = <T extends { id: string }>(ids: string[], rows: T[]): T[] => {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}
