import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

type Metrics = {
  window_days: number
  total_searches: number
  unique_queries: number
  zero_result_count: number
  zero_result_rate: number
  top_queries: { query: string; count: number }[]
  top_zero_queries: { query: string; count: number }[]
  daily: { date: string; total: number; zero: number }[]
}

type SearchLog = {
  id: string
  query: string
  result_count: number
  result_ids: string[] | null
  customer_id: string | null
  session_id: string | null
  sales_channel_id: string | null
  user_agent: string | null
  created_at: string
}

type ListResponse = {
  search_logs: SearchLog[]
  count: number
  limit: number
  offset: number
}

const WINDOWS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
]

const PAGE_SIZE = 20

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const percent = (n: number) => `${(n * 100).toFixed(1)}%`

const formatRelative = (iso: string) => {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const s = Math.floor(diffMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const day = Math.floor(h / 24)
  return `${day}d ago`
}

const MetricCard = ({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) => (
  <div className="bg-ui-bg-subtle border-ui-border-base flex flex-col gap-1 rounded-lg border px-4 py-3">
    <Text size="xsmall" className="text-ui-fg-muted">
      {label}
    </Text>
    <Text weight="plus" size="xlarge" className="text-ui-fg-base">
      {value}
    </Text>
    {hint ? (
      <Text size="xsmall" className="text-ui-fg-subtle">
        {hint}
      </Text>
    ) : null}
  </div>
)

const TopList = ({
  title,
  items,
  emptyHint,
}: {
  title: string
  items: { query: string; count: number }[]
  emptyHint: string
}) => (
  <div className="bg-ui-bg-base border-ui-border-base flex flex-col rounded-lg border p-4">
    <Heading level="h3" className="mb-3">
      {title}
    </Heading>
    {items.length === 0 ? (
      <Text size="small" className="text-ui-fg-muted">
        {emptyHint}
      </Text>
    ) : (
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div
            key={`${it.query}-${i}`}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Text size="xsmall" className="text-ui-fg-muted w-5">
                {i + 1}
              </Text>
              <Text
                size="small"
                weight="plus"
                className="truncate"
                title={it.query}
              >
                {it.query}
              </Text>
            </div>
            <Badge size="2xsmall">{it.count}</Badge>
          </div>
        ))}
      </div>
    )}
  </div>
)

const SearchInsightsPage = () => {
  const [days, setDays] = useState(7)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)

  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [list, setList] = useState<ListResponse | null>(null)
  const [loadingList, setLoadingList] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setOffset(0)
  }, [debouncedQ])

  useEffect(() => {
    let cancelled = false
    setLoadingMetrics(true)
    fetchJson<Metrics>(`/admin/search-logs/metrics?days=${days}`)
      .then((data) => {
        if (!cancelled) setMetrics(data)
      })
      .catch(() => {
        if (!cancelled) setMetrics(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingMetrics(false)
      })
    return () => {
      cancelled = true
    }
  }, [days])

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (debouncedQ) params.set("q", debouncedQ)
    fetchJson<ListResponse>(`/admin/search-logs?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setList(data)
      })
      .catch(() => {
        if (!cancelled) setList(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ, offset])

  const rate = metrics ? percent(metrics.zero_result_rate) : "—"
  const total = metrics?.total_searches ?? 0
  const unique = metrics?.unique_queries ?? 0
  const zero = metrics?.zero_result_count ?? 0

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  const maxDaily = useMemo(
    () => (metrics?.daily ?? []).reduce((m, d) => Math.max(m, d.total), 0),
    [metrics]
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Search Insights</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Customer-side search activity across the store.
          </Text>
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.value}
              size="small"
              variant={days === w.value ? "primary" : "secondary"}
              onClick={() => setDays(w.value)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-6 md:grid-cols-4">
        <MetricCard
          label="Total searches"
          value={loadingMetrics ? "…" : total.toLocaleString()}
          hint={`last ${days} days`}
        />
        <MetricCard
          label="Unique queries"
          value={loadingMetrics ? "…" : unique.toLocaleString()}
        />
        <MetricCard
          label="Zero-result"
          value={loadingMetrics ? "…" : zero.toLocaleString()}
        />
        <MetricCard
          label="Zero-result rate"
          value={loadingMetrics ? "…" : rate}
          hint="lower is better"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 px-6 pb-6 md:grid-cols-2">
        <TopList
          title="Top searches"
          items={metrics?.top_queries ?? []}
          emptyHint="No searches in this window yet."
        />
        <TopList
          title="Top zero-result searches"
          items={metrics?.top_zero_queries ?? []}
          emptyHint="No zero-result searches — nice."
        />
      </div>

      {metrics && metrics.daily.length > 0 ? (
        <div className="px-6 pb-6">
          <Heading level="h3" className="mb-3">
            Daily volume
          </Heading>
          <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-4">
            <div className="flex h-28 items-end gap-1">
              {metrics.daily.map((d) => {
                const h =
                  maxDaily === 0 ? 4 : Math.max(4, (d.total / maxDaily) * 100)
                return (
                  <div
                    key={d.date}
                    className="group relative flex-1"
                    title={`${d.date} — ${d.total} searches (${d.zero} zero-result)`}
                  >
                    <div
                      className="bg-ui-fg-interactive mx-auto w-2 rounded-t"
                      style={{ height: `${h}%` }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="text-ui-fg-muted mt-2 flex justify-between text-[10px]">
              <span>{metrics.daily[0]?.date}</span>
              <span>{metrics.daily[metrics.daily.length - 1]?.date}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h3">Search history</Heading>
        <div className="w-64">
          <Input
            placeholder="Filter queries…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="px-6 pb-6">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Time</Table.HeaderCell>
              <Table.HeaderCell>Query</Table.HeaderCell>
              <Table.HeaderCell>Results</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Session</Table.HeaderCell>
              <Table.HeaderCell>Channel</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loadingList && !list ? (
              <Table.Row>
                <Table.Cell colSpan={6}>
                  <Text size="small" className="text-ui-fg-muted">
                    Loading…
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : list && list.search_logs.length > 0 ? (
              list.search_logs.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    <Text size="small" title={r.created_at}>
                      {formatRelative(r.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <MagnifyingGlass className="text-ui-fg-muted" />
                      <Text size="small" weight="plus">
                        {r.query}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="2xsmall"
                      color={r.result_count === 0 ? "red" : "green"}
                    >
                      {r.result_count}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {r.customer_id ?? "anon"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {r.session_id ?? "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {r.sales_channel_id ?? "—"}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row>
                <Table.Cell colSpan={6}>
                  <Text size="small" className="text-ui-fg-muted">
                    No searches match your filter.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list
              ? `Showing ${list.search_logs.length === 0 ? 0 : offset + 1}–${
                  offset + list.search_logs.length
                } of ${list.count}`
              : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={offset === 0 || loadingList}
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
              disabled={
                !list || offset + PAGE_SIZE >= list.count || loadingList
              }
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
  label: "Search Insights",
  icon: MagnifyingGlass,
})

export default SearchInsightsPage
