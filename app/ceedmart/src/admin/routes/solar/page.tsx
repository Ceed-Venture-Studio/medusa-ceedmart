import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BoltSolid } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// ─── Types ────────────────────────────────────────────────────────────────

type SolarComponent = {
  product_id: string
  variant_id: string | null
  title: string
  thumbnail: string | null
  qty: number
  unit_price: number | null
  currency_code: string | null
  capacity_kw?: number
  capacity_kwh?: number
  panel_watts?: number
}

type SolarBundle = {
  tier: "budget" | "recommended" | "premium"
  margin_pct: number
  inverter: SolarComponent | null
  battery: SolarComponent | null
  panels: SolarComponent | null
  total_price: number | null
  currency_code: string | null
  why: string[]
  can_power: { label: string; qty: number }[]
  cannot_power: string[]
}

type Quote = {
  id: string
  calculation_id: string | null
  selected_tier: SolarBundle["tier"]
  selected_bundle: SolarBundle
  customer_name: string
  customer_email: string
  customer_phone: string | null
  customer_location: string | null
  notes: string | null
  status: "new" | "contacted" | "quoted" | "won" | "lost"
  email_sent_at: string | null
  created_at: string
  updated_at: string
}

type Calculation = {
  id: string
  appliances: any[]
  total_load_w: number
  daily_kwh: number
  night_kwh: number
  has_heavy_motors: boolean
  margin_pct: number
  recommendations: any
  session_id: string | null
  sales_channel_id: string | null
  locale: string | null
  user_agent: string | null
  created_at: string
}

type Metrics = {
  window_days: number
  total_calculations: number
  total_quotes: number
  conversion_rate: number
  by_status: Record<string, number>
  by_tier: Record<string, number>
  avg_quote_value: number | null
  won_value: number | null
  won_count: number
  currency_code: string | null
  daily: { date: string; calcs: number; quotes: number }[]
}

type QuotesResp = { quotes: Quote[]; count: number; limit: number; offset: number }
type CalcsResp = { calculations: Calculation[]; count: number; limit: number; offset: number }
type QuoteDetail = { quote: Quote; calculation: Calculation | null }

// ─── Helpers ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
const STATUSES: Quote["status"][] = ["new", "contacted", "quoted", "won", "lost"]
const TIERS: SolarBundle["tier"][] = ["budget", "recommended", "premium"]

const fetchJson = fetchAdmin

const formatRelative = (iso: string) => {
  const d = new Date(iso)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const formatMoney = (n: number | null | undefined, ccy: string | null | undefined) => {
  if (n == null) return "—"
  if (!ccy) return n.toLocaleString()
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: ccy.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${ccy.toUpperCase()} ${n.toLocaleString()}`
  }
}

const statusColor = (s: Quote["status"]): "grey" | "blue" | "orange" | "green" | "red" => {
  switch (s) {
    case "new": return "blue"
    case "contacted": return "orange"
    case "quoted": return "orange"
    case "won": return "green"
    case "lost": return "red"
    default: return "grey"
  }
}

// ─── UI sub-components ────────────────────────────────────────────────────

const MetricCard = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="bg-ui-bg-subtle border-ui-border-base flex flex-col gap-1 rounded-lg border px-4 py-3">
    <Text size="xsmall" className="text-ui-fg-muted">{label}</Text>
    <Text weight="plus" size="xlarge" className="text-ui-fg-base">{value}</Text>
    {hint ? <Text size="xsmall" className="text-ui-fg-subtle">{hint}</Text> : null}
  </div>
)

const ComponentRow = ({ label, c }: { label: string; c: SolarComponent | null }) => {
  if (!c) return (
    <div className="flex items-center justify-between py-2">
      <Text size="small" className="text-ui-fg-muted">{label}</Text>
      <Text size="small" className="text-ui-fg-muted">—</Text>
    </div>
  )
  const cap = c.capacity_kw != null ? `${c.capacity_kw} kW`
    : c.capacity_kwh != null ? `${c.capacity_kwh} kWh`
    : c.panel_watts != null ? `${c.panel_watts} W` : ""
  return (
    <div className="border-ui-border-base flex items-start justify-between border-b py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <Text size="small" weight="plus">{c.title}</Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {label} · {cap} · qty {c.qty}
        </Text>
      </div>
      <Text size="small" className="text-ui-fg-base whitespace-nowrap">
        {formatMoney(c.unit_price, c.currency_code)}
      </Text>
    </div>
  )
}

const QuoteDrawer = ({
  quoteId,
  onClose,
  onStatusChanged,
}: {
  quoteId: string | null
  onClose: () => void
  onStatusChanged: () => void
}) => {
  const [data, setData] = useState<QuoteDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const open = !!quoteId

  useEffect(() => {
    if (!quoteId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    fetchJson<QuoteDetail>(`/admin/solar/quotes/${quoteId}`)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [quoteId])

  const updateStatus = async (status: Quote["status"]) => {
    if (!quoteId) return
    setUpdating(true)
    try {
      const r = await fetchJson<{ quote: Quote }>(
        `/admin/solar/quotes/${quoteId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      )
      setData((prev) => (prev ? { ...prev, quote: r.quote } : prev))
      toast.success(`Status updated to ${status}`)
      onStatusChanged()
    } catch (e: any) {
      toast.error(`Update failed: ${e?.message ?? e}`)
    } finally {
      setUpdating(false)
    }
  }

  const q = data?.quote
  const b = q?.selected_bundle
  const calc = data?.calculation

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{q ? q.customer_name : "Quote"}</Drawer.Title>
          <Drawer.Description>
            {q ? `${q.id} · ${formatRelative(q.created_at)}` : ""}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {loading || !q || !b ? (
            <Text size="small" className="text-ui-fg-muted">Loading…</Text>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <StatusBadge color={statusColor(q.status)}>{q.status}</StatusBadge>
                <Badge size="2xsmall">{q.selected_tier}</Badge>
                {q.email_sent_at ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Email sent {formatRelative(q.email_sent_at)}
                  </Text>
                ) : (
                  <Text size="xsmall" className="text-ui-fg-error">Email not sent</Text>
                )}
              </div>

              <div>
                <Heading level="h3" className="mb-2">Customer</Heading>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" value={q.customer_email} copyable />
                  <Field label="Phone" value={q.customer_phone ?? "—"} copyable={!!q.customer_phone} />
                  <Field label="Location" value={q.customer_location ?? "—"} />
                  <Field label="Calculation" value={q.calculation_id ?? "—"} />
                </div>
                {q.notes ? (
                  <div className="bg-ui-bg-subtle mt-3 rounded-lg p-3">
                    <Text size="xsmall" className="text-ui-fg-muted">Customer notes</Text>
                    <Text size="small">{q.notes}</Text>
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Heading level="h3">Selected bundle</Heading>
                  <Text size="small" weight="plus">
                    {formatMoney(b.total_price, b.currency_code)}
                  </Text>
                </div>
                <div className="bg-ui-bg-base border-ui-border-base rounded-lg border px-3">
                  <ComponentRow label="Inverter" c={b.inverter} />
                  <ComponentRow label="Battery" c={b.battery} />
                  <ComponentRow label="Panels" c={b.panels} />
                </div>
                {b.why.length > 0 ? (
                  <ul className="text-ui-fg-subtle mt-3 list-disc pl-5 text-sm">
                    {b.why.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                ) : null}
              </div>

              {b.can_power.length > 0 ? (
                <div>
                  <Heading level="h3" className="mb-2">Can power</Heading>
                  <div className="flex flex-wrap gap-2">
                    {b.can_power.map((cp, i) => (
                      <Badge key={i} size="2xsmall">{cp.qty}× {cp.label}</Badge>
                    ))}
                  </div>
                  {b.cannot_power.length > 0 ? (
                    <Text size="xsmall" className="text-ui-fg-muted mt-2">
                      Not for: {b.cannot_power.join(", ")}
                    </Text>
                  ) : null}
                </div>
              ) : null}

              {calc ? (
                <div>
                  <Heading level="h3" className="mb-2">Original load</Heading>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Total load" value={`${(calc.total_load_w / 1000).toFixed(1)} kW`} />
                    <Field label="Daily energy" value={`${calc.daily_kwh} kWh`} />
                    <Field label="Night energy" value={`${calc.night_kwh} kWh`} />
                  </div>
                  <Heading level="h3" className="mb-2 mt-4">Appliances</Heading>
                  <div className="bg-ui-bg-base border-ui-border-base overflow-hidden rounded-lg border">
                    <Table>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Name</Table.HeaderCell>
                          <Table.HeaderCell>Qty</Table.HeaderCell>
                          <Table.HeaderCell>Watts</Table.HeaderCell>
                          <Table.HeaderCell>Hrs</Table.HeaderCell>
                          <Table.HeaderCell>Period</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {calc.appliances.map((a, i) => (
                          <Table.Row key={i}>
                            <Table.Cell>{a.name}</Table.Cell>
                            <Table.Cell>{a.qty}</Table.Cell>
                            <Table.Cell>{a.watts}W</Table.Cell>
                            <Table.Cell>{a.hours_per_day}h</Table.Cell>
                            <Table.Cell>{a.period}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex w-full items-center justify-between gap-2">
            <Select
              value={q?.status}
              onValueChange={(v) => updateStatus(v as Quote["status"])}
              disabled={updating || !q}
            >
              <Select.Trigger className="w-44">
                <Select.Value placeholder="Set status" />
              </Select.Trigger>
              <Select.Content>
                {STATUSES.map((s) => (
                  <Select.Item key={s} value={s}>{s}</Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Drawer.Close asChild>
              <Button variant="secondary">Close</Button>
            </Drawer.Close>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const Field = ({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) => (
  <div>
    <Text size="xsmall" className="text-ui-fg-muted">{label}</Text>
    {copyable && value !== "—" ? (
      <button
        type="button"
        className="text-ui-fg-base hover:text-ui-fg-interactive text-left text-sm"
        onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied") }}
      >
        {value}
      </button>
    ) : (
      <Text size="small">{value}</Text>
    )}
  </div>
)

// ─── Page ─────────────────────────────────────────────────────────────────

const SolarPage = () => {
  // Metrics
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [days, setDays] = useState(30)

  // Quote list state
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [tierFilter, setTierFilter] = useState<string>("all")
  const [qOffset, setQOffset] = useState(0)
  const [quotes, setQuotes] = useState<QuotesResp | null>(null)
  const [loadingQuotes, setLoadingQuotes] = useState(false)

  // Calc list state
  const [cOffset, setCOffset] = useState(0)
  const [calcs, setCalcs] = useState<CalcsResp | null>(null)
  const [loadingCalcs, setLoadingCalcs] = useState(false)
  const [heavyOnly, setHeavyOnly] = useState(false)

  // Drawer
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setQOffset(0) }, [debouncedQ, statusFilter, tierFilter])
  useEffect(() => { setCOffset(0) }, [heavyOnly])

  useEffect(() => {
    let cancelled = false
    fetchJson<Metrics>(`/admin/solar/metrics?days=${days}`)
      .then((d) => { if (!cancelled) setMetrics(d) })
      .catch(() => { if (!cancelled) setMetrics(null) })
    return () => { cancelled = true }
  }, [days, refreshTick])

  useEffect(() => {
    let cancelled = false
    setLoadingQuotes(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(qOffset))
    if (debouncedQ) params.set("q", debouncedQ)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (tierFilter !== "all") params.set("selected_tier", tierFilter)
    fetchJson<QuotesResp>(`/admin/solar/quotes?${params.toString()}`)
      .then((d) => { if (!cancelled) setQuotes(d) })
      .catch(() => { if (!cancelled) setQuotes(null) })
      .finally(() => { if (!cancelled) setLoadingQuotes(false) })
    return () => { cancelled = true }
  }, [debouncedQ, statusFilter, tierFilter, qOffset, refreshTick])

  useEffect(() => {
    let cancelled = false
    setLoadingCalcs(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(cOffset))
    if (heavyOnly) params.set("has_heavy_motors", "true")
    fetchJson<CalcsResp>(`/admin/solar/calculations?${params.toString()}`)
      .then((d) => { if (!cancelled) setCalcs(d) })
      .catch(() => { if (!cancelled) setCalcs(null) })
      .finally(() => { if (!cancelled) setLoadingCalcs(false) })
    return () => { cancelled = true }
  }, [cOffset, heavyOnly, refreshTick])

  const qPage = Math.floor(qOffset / PAGE_SIZE) + 1
  const qPages = quotes ? Math.max(1, Math.ceil(quotes.count / PAGE_SIZE)) : 1
  const cPage = Math.floor(cOffset / PAGE_SIZE) + 1
  const cPages = calcs ? Math.max(1, Math.ceil(calcs.count / PAGE_SIZE)) : 1

  const maxDaily = useMemo(
    () => (metrics?.daily ?? []).reduce((m, d) => Math.max(m, d.calcs, d.quotes), 0),
    [metrics]
  )
  const ccy = metrics?.currency_code ?? null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Solar</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Quote requests and load calculations from the storefront calculator.
          </Text>
        </div>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((w) => (
            <Button
              key={w}
              size="small"
              variant={days === w ? "primary" : "secondary"}
              onClick={() => setDays(w)}
            >
              {w}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-6 md:grid-cols-5">
        <MetricCard label="Calculations" value={metrics?.total_calculations.toLocaleString() ?? "—"} hint={`last ${days}d`} />
        <MetricCard label="Quotes" value={metrics?.total_quotes.toLocaleString() ?? "—"} />
        <MetricCard
          label="Conversion"
          value={metrics ? `${(metrics.conversion_rate * 100).toFixed(1)}%` : "—"}
          hint="quotes / calcs"
        />
        <MetricCard
          label="Avg quote"
          value={formatMoney(metrics?.avg_quote_value ?? null, ccy)}
        />
        <MetricCard
          label="Won"
          value={`${metrics?.won_count ?? 0}`}
          hint={metrics?.won_value ? formatMoney(metrics.won_value, ccy) : undefined}
        />
      </div>

      {metrics && metrics.daily.length > 0 ? (
        <div className="px-6 pb-4">
          <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <Text size="xsmall" className="text-ui-fg-muted">Daily activity</Text>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="bg-ui-fg-muted h-2 w-2 rounded-sm" /> calcs
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-ui-fg-interactive h-2 w-2 rounded-sm" /> quotes
                </span>
              </div>
            </div>
            <div className="flex h-24 items-end gap-1">
              {metrics.daily.map((d) => (
                <div key={d.date} className="flex flex-1 items-end justify-center gap-[1px]" title={`${d.date} · ${d.calcs} calcs · ${d.quotes} quotes`}>
                  <div className="bg-ui-fg-muted w-1 rounded-t" style={{ height: `${maxDaily ? (d.calcs / maxDaily) * 100 : 0}%` }} />
                  <div className="bg-ui-fg-interactive w-1 rounded-t" style={{ height: `${maxDaily ? (d.quotes / maxDaily) * 100 : 0}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-6 pb-6">
        <Tabs defaultValue="quotes">
          <Tabs.List>
            <Tabs.Trigger value="quotes">
              Quotes {quotes ? <Badge size="2xsmall" className="ml-2">{quotes.count}</Badge> : null}
            </Tabs.Trigger>
            <Tabs.Trigger value="calcs">
              Calculations {calcs ? <Badge size="2xsmall" className="ml-2">{calcs.count}</Badge> : null}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="quotes" className="pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="w-64">
                <Input
                  placeholder="Filter by name / email / phone…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <Select.Trigger className="w-36"><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All statuses</Select.Item>
                  {STATUSES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
                </Select.Content>
              </Select>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <Select.Trigger className="w-36"><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All tiers</Select.Item>
                  {TIERS.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                </Select.Content>
              </Select>
              <Button size="small" variant="secondary" onClick={() => setRefreshTick((n) => n + 1)}>
                Refresh
              </Button>
            </div>

            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Time</Table.HeaderCell>
                  <Table.HeaderCell>Customer</Table.HeaderCell>
                  <Table.HeaderCell>Tier</Table.HeaderCell>
                  <Table.HeaderCell>Bundle</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Email</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {loadingQuotes && !quotes ? (
                  <Table.Row><Table.Cell colSpan={6}><Text size="small" className="text-ui-fg-muted">Loading…</Text></Table.Cell></Table.Row>
                ) : quotes && quotes.quotes.length > 0 ? (
                  quotes.quotes.map((qq) => (
                    <Table.Row
                      key={qq.id}
                      className="cursor-pointer"
                      onClick={() => setOpenQuoteId(qq.id)}
                    >
                      <Table.Cell>
                        <Text size="small" title={qq.created_at}>{formatRelative(qq.created_at)}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <Text size="small" weight="plus">{qq.customer_name}</Text>
                          <Text size="xsmall" className="text-ui-fg-muted">{qq.customer_email}</Text>
                        </div>
                      </Table.Cell>
                      <Table.Cell><Badge size="2xsmall">{qq.selected_tier}</Badge></Table.Cell>
                      <Table.Cell>
                        <Text size="small">{formatMoney(qq.selected_bundle?.total_price, qq.selected_bundle?.currency_code)}</Text>
                      </Table.Cell>
                      <Table.Cell><StatusBadge color={statusColor(qq.status)}>{qq.status}</StatusBadge></Table.Cell>
                      <Table.Cell>
                        {qq.email_sent_at ? (
                          <Text size="xsmall" className="text-ui-fg-muted">sent</Text>
                        ) : (
                          <Text size="xsmall" className="text-ui-fg-error">not sent</Text>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))
                ) : (
                  <Table.Row><Table.Cell colSpan={6}><Text size="small" className="text-ui-fg-muted">No quotes match.</Text></Table.Cell></Table.Row>
                )}
              </Table.Body>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <Text size="small" className="text-ui-fg-muted">
                {quotes ? `Showing ${quotes.quotes.length === 0 ? 0 : qOffset + 1}–${qOffset + quotes.quotes.length} of ${quotes.count}` : "—"}
              </Text>
              <div className="flex items-center gap-2">
                <Button size="small" variant="secondary" disabled={qOffset === 0 || loadingQuotes} onClick={() => setQOffset(Math.max(0, qOffset - PAGE_SIZE))}>Previous</Button>
                <Text size="small" className="text-ui-fg-muted">Page {qPage} of {qPages}</Text>
                <Button size="small" variant="secondary" disabled={!quotes || qOffset + PAGE_SIZE >= quotes.count || loadingQuotes} onClick={() => setQOffset(qOffset + PAGE_SIZE)}>Next</Button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="calcs" className="pt-4">
            <div className="mb-3 flex items-center gap-2">
              <Select value={heavyOnly ? "true" : "all"} onValueChange={(v) => setHeavyOnly(v === "true")}>
                <Select.Trigger className="w-44"><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All loads</Select.Item>
                  <Select.Item value="true">Heavy motors only</Select.Item>
                </Select.Content>
              </Select>
              <Button size="small" variant="secondary" onClick={() => setRefreshTick((n) => n + 1)}>Refresh</Button>
            </div>

            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Time</Table.HeaderCell>
                  <Table.HeaderCell>Total load</Table.HeaderCell>
                  <Table.HeaderCell>Daily kWh</Table.HeaderCell>
                  <Table.HeaderCell>Night kWh</Table.HeaderCell>
                  <Table.HeaderCell>Heavy</Table.HeaderCell>
                  <Table.HeaderCell>Session</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {loadingCalcs && !calcs ? (
                  <Table.Row><Table.Cell colSpan={6}><Text size="small" className="text-ui-fg-muted">Loading…</Text></Table.Cell></Table.Row>
                ) : calcs && calcs.calculations.length > 0 ? (
                  calcs.calculations.map((c) => (
                    <Table.Row key={c.id}>
                      <Table.Cell><Text size="small">{formatRelative(c.created_at)}</Text></Table.Cell>
                      <Table.Cell><Text size="small">{(c.total_load_w / 1000).toFixed(2)} kW</Text></Table.Cell>
                      <Table.Cell><Text size="small">{c.daily_kwh}</Text></Table.Cell>
                      <Table.Cell><Text size="small">{c.night_kwh}</Text></Table.Cell>
                      <Table.Cell>
                        {c.has_heavy_motors ? <Badge size="2xsmall" color="orange">heavy</Badge> : <Text size="xsmall" className="text-ui-fg-muted">—</Text>}
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="xsmall" className="text-ui-fg-subtle truncate" title={c.session_id ?? ""}>
                          {c.session_id ?? "—"}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))
                ) : (
                  <Table.Row><Table.Cell colSpan={6}><Text size="small" className="text-ui-fg-muted">No calculations yet.</Text></Table.Cell></Table.Row>
                )}
              </Table.Body>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <Text size="small" className="text-ui-fg-muted">
                {calcs ? `Showing ${calcs.calculations.length === 0 ? 0 : cOffset + 1}–${cOffset + calcs.calculations.length} of ${calcs.count}` : "—"}
              </Text>
              <div className="flex items-center gap-2">
                <Button size="small" variant="secondary" disabled={cOffset === 0 || loadingCalcs} onClick={() => setCOffset(Math.max(0, cOffset - PAGE_SIZE))}>Previous</Button>
                <Text size="small" className="text-ui-fg-muted">Page {cPage} of {cPages}</Text>
                <Button size="small" variant="secondary" disabled={!calcs || cOffset + PAGE_SIZE >= calcs.count || loadingCalcs} onClick={() => setCOffset(cOffset + PAGE_SIZE)}>Next</Button>
              </div>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>

      <QuoteDrawer
        quoteId={openQuoteId}
        onClose={() => setOpenQuoteId(null)}
        onStatusChanged={() => setRefreshTick((n) => n + 1)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Solar",
  icon: BoltSolid,
})

export default SolarPage
