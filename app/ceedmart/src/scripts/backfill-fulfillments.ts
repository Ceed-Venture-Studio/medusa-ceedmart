import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fulfillOrderNow } from "../lib/pos/fulfill"

// Close out orders that were paid and handed over but never fulfilled.
//
// Before the POS record-payment route created a fulfillment, a till sale
// left its reservation open forever: reserved_quantity stayed up and
// stocked_quantity kept counting goods that had already left the shop.
// This walks the open reservations and fulfils the orders behind them,
// which deletes the reservation and finally decrements the real count.
//
// ── Read this before running it anywhere but local ──────────────────────
// Fulfilling asserts the goods have LEFT. That is true of a till sale, and
// false of an online order still sitting in the warehouse waiting to be
// picked — for those the open reservation is correct and this would wrongly
// decrement stock. So it defaults to a dry run and prints what it found;
// pass --apply once you have read the list and agree every order on it has
// actually been handed over.
//
//   npx medusa exec ./src/scripts/backfill-fulfillments.ts
//   npx medusa exec ./src/scripts/backfill-fulfillments.ts apply
//
// Restrict it to a channel when only the till's sales should be closed:
//
//   npx medusa exec ./src/scripts/backfill-fulfillments.ts apply channel=sc_01ABC
//
// Bare words, not flags: `medusa exec` declares its arguments as the yargs
// positional `[args..]`, so anything starting with `--` is parsed as an
// option to the CLI itself and never reaches the script. Both spellings are
// accepted so a `--apply` out of habit still works.
//
// Idempotent: fulfillOrderNow subtracts what is already fulfilled, so a
// second run is a no-op.

export default async function backfillFulfillments({ container, args }: any) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const argv: string[] = (args ?? []).map((a: string) => a.replace(/^--/, ""))
  const apply = argv.includes("apply")
  const channel = argv.find((a) => a.startsWith("channel="))?.split("=")[1]

  const { data: reservations } = await query.graph({
    entity: "reservation",
    fields: ["id", "line_item_id", "quantity", "location_id"],
    filters: {},
  })

  const lineItemIds = [
    ...new Set((reservations as any[]).map((r) => r.line_item_id).filter(Boolean)),
  ]
  if (!lineItemIds.length) {
    logger.info("[backfill] no open reservations — nothing to do")
    return
  }

  // Reservations point at line items; walk back to the orders behind them.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "status",
      "created_at",
      "sales_channel_id",
      "sales_channel.name",
      "items.id",
      "items.title",
      "items.detail.quantity",
      "items.detail.fulfilled_quantity",
      "fulfillments.id",
    ],
    filters: {},
  })

  const wanted = new Set(lineItemIds)
  const candidates = (orders as any[]).filter((o) => {
    if (channel && o.sales_channel_id !== channel) return false
    if (o.fulfillments?.length) {
      // Partially fulfilled orders still count if something is outstanding.
      const outstanding = (o.items ?? []).some(
        (i: any) =>
          wanted.has(i.id) &&
          Number(i.detail?.quantity ?? 0) -
            Number(i.detail?.fulfilled_quantity ?? 0) >
            0
      )
      if (!outstanding) return false
    }
    return (o.items ?? []).some((i: any) => wanted.has(i.id))
  })

  if (!candidates.length) {
    logger.info("[backfill] no orders behind those reservations matched")
    return
  }

  logger.info(
    `[backfill] ${candidates.length} order(s) with open reservations${
      channel ? ` in channel ${channel}` : ""
    }:`
  )
  for (const o of candidates) {
    const items = (o.items ?? [])
      .filter((i: any) => wanted.has(i.id))
      .map((i: any) => `${i.title} x${i.detail?.quantity ?? "?"}`)
      .join("; ")
    logger.info(
      `  #${o.display_id} | ${o.sales_channel?.name ?? "no channel"} | ` +
        `${new Date(o.created_at).toISOString().slice(0, 10)} | ` +
        `${o.email ?? "no email"} | ${items}`
    )
  }

  if (!apply) {
    logger.info(
      "[backfill] DRY RUN — nothing changed. Re-run with -- --apply once you " +
        "have confirmed every order above was actually handed over."
    )
    return
  }

  let done = 0
  for (const o of candidates) {
    try {
      const result = await fulfillOrderNow(container, o.id)
      if (result.fulfilled) {
        done++
        logger.info(
          `[backfill] #${o.display_id} fulfilled (${result.fulfillment_ids.join(", ")})`
        )
      } else {
        logger.warn(`[backfill] #${o.display_id} skipped: ${result.reason}`)
      }
    } catch (err: any) {
      // One bad order must not strand the rest.
      logger.error(
        `[backfill] #${o.display_id} failed: ${err?.message ?? err}`
      )
    }
  }

  logger.info(`[backfill] fulfilled ${done} of ${candidates.length} order(s)`)
}
