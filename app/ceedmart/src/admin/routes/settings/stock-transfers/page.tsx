import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowLongRight } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { fetchAdmin } from "../../../lib/client"

type Transfer = {
  id: string
  from_location_id: string
  to_location_id: string
  from_location_name: string | null
  to_location_name: string | null
  inventory_item_id: string
  variant_id: string | null
  variant_sku: string | null
  product_title: string | null
  quantity: number
  order_id: string | null
  order_display_id: number | null
  reason: string
  status: string
  created_at: string
}

type ListResp = {
  transfers: Transfer[]
  count: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

const relative = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const StockTransfersPage = () => {
  const [list, setList] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    setOffset(0)
  }, [debouncedQ])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (debouncedQ) params.set("q", debouncedQ)
    fetchAdmin<ListResp>(`/admin/stock-transfers?${params}`)
      .then((d) => {
        if (!cancelled) setList(d)
      })
      .catch(() => {
        if (!cancelled) setList(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ, offset, refreshTick])

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Stock transfers</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Inventory pulled between locations. Auto-recorded when an order
            can't be covered by the fulfilling location and the shop's
            sourcing priority has a fallback with stock.
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={() => setRefreshTick((n) => n + 1)}
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="w-72">
          <Input
            placeholder="Filter by product or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="px-6 pb-6">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Item</Table.HeaderCell>
              <Table.HeaderCell>Qty</Table.HeaderCell>
              <Table.HeaderCell>Movement</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && !list ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-muted">
                    Loading…
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : list && list.transfers.length > 0 ? (
              list.transfers.map((t) => (
                <Table.Row key={t.id}>
                  <Table.Cell>
                    <Text size="small">{relative(t.created_at)}</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {new Date(t.created_at).toLocaleString()}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {t.product_title ?? "(unknown item)"}
                    </Text>
                    {t.variant_sku && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        SKU {t.variant_sku}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {t.quantity}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2 text-ui-fg-base">
                      <Badge size="2xsmall">
                        {t.from_location_name ?? t.from_location_id}
                      </Badge>
                      <ArrowLongRight />
                      <Badge size="2xsmall">
                        {t.to_location_name ?? t.to_location_id}
                      </Badge>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {t.order_display_id != null ? (
                      <Text size="small">#{t.order_display_id}</Text>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t.reason}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-muted">
                    No transfers yet.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list
              ? `Showing ${
                  list.transfers.length === 0 ? 0 : offset + 1
                }–${offset + list.transfers.length} of ${list.count}`
              : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Text size="small" className="text-ui-fg-muted">
              Page {page} of {totalPages}
            </Text>
            <Button
              size="small"
              variant="secondary"
              disabled={!list || offset + PAGE_SIZE >= list.count || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Stock transfers",
  icon: ArrowLongRight,
})

export default StockTransfersPage
