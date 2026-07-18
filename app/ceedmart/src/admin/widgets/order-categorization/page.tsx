import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// Renders the Ceedmart order-categorization block as a compact
// four-badge row on the order detail sidebar. Reads
// order.metadata.ceedmart written by the storefront on cart complete
// and the POS on order capture.
//
// If any dimension is missing (older orders placed before H3 shipped,
// or unusual paths), the widget shows an "unknown" muted badge for
// that dimension rather than hiding the whole row — lets ops spot
// gaps quickly.

type Ceedmart = {
  channel?: "online" | "in-store"
  store_id?: string
  fulfillment?: "pickup" | "delivery"
  sourcing?: "local" | "cross-warehouse"
}

const channelColor: Record<string, "blue" | "orange" | "grey"> = {
  online: "blue",
  "in-store": "orange",
}
const fulfillmentColor: Record<string, "green" | "purple" | "grey"> = {
  pickup: "purple",
  delivery: "green",
}
const sourcingColor: Record<string, "grey" | "red"> = {
  local: "grey",
  "cross-warehouse": "red",
}

const OrderCategorizationWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  const md = ((order.metadata as any)?.ceedmart ?? {}) as Ceedmart
  const [storeName, setStoreName] = useState<string | null>(null)

  useEffect(() => {
    if (!md.store_id) return
    let cancelled = false
    fetchAdmin<{ shop: any }>(`/admin/shops/${md.store_id}`)
      .then((r) => {
        if (!cancelled) setStoreName(r?.shop?.name ?? null)
      })
      .catch(() => {
        /* not a shop id — fine */
      })
    return () => {
      cancelled = true
    }
  }, [md.store_id])

  const hasAny =
    md.channel != null ||
    md.fulfillment != null ||
    md.sourcing != null ||
    md.store_id != null

  return (
    <Container className="p-0 divide-y">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Order type</Heading>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        {!hasAny && (
          <Text size="small" className="text-ui-fg-subtle">
            No categorization data. Order was placed before the H3
            categorization ships, or via an untagged path.
          </Text>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={md.channel ? channelColor[md.channel] : "grey"}>
            {md.channel ? md.channel : "channel unknown"}
          </Badge>
          {storeName && (
            <Badge color="blue">📍 {storeName}</Badge>
          )}
          <Badge color={md.fulfillment ? fulfillmentColor[md.fulfillment] : "grey"}>
            {md.fulfillment ?? "fulfillment unknown"}
          </Badge>
          <Badge color={md.sourcing ? sourcingColor[md.sourcing] : "grey"}>
            {md.sourcing === "cross-warehouse"
              ? "cross-warehouse pull"
              : md.sourcing ?? "sourcing unknown"}
          </Badge>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderCategorizationWidget
