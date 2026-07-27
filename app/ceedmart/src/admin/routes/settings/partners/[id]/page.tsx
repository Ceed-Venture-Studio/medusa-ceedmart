import {
  Badge,
  Button,
  Container,
  Heading,
  Select,
  StatusBadge,
  Table,
  Text,
} from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../../../lib/client"

type TierCode = "SHOPPER" | "EMPLOYEE_SALES" | "RESELLER" | "PARTNER"

const TIER_LABELS: Record<TierCode, string> = {
  SHOPPER: "Shopper",
  EMPLOYEE_SALES: "Employee Sales",
  RESELLER: "Reseller",
  PARTNER: "Partner",
}

type Partner = {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  code: string
  tier: TierCode
  commission_rate: number
  status: "active" | "inactive" | "suspended"
  notes: string | null
  created_at: string
  updated_at: string
}

type Entry = {
  id: string
  partner_id: string
  partner_code: string
  order_id: string
  order_display_id: number | null
  eligible_amount: number | string | { value: string }
  eligible_basis: string
  currency_code: string
  commission_rate: number
  commission_amount: number | string | { value: string }
  status: "pending" | "earned" | "reversed"
  reason: string | null
  created_at: string
}

type Totals = {
  pending_amount: number
  earned_amount: number
  reversed_amount: number
  net_amount: number
  eligible_amount: number
}

type ListResp = {
  entries: Entry[]
  count: number
  limit: number
  offset: number
  totals: Totals
}

const asNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return v
  if (typeof v === "string") return parseFloat(v) || 0
  if (v && typeof v === "object" && "value" in (v as any)) {
    return Number((v as any).value) || 0
  }
  return 0
}

const money = (n: number, currency: string) => {
  const cc = (currency || "").toLowerCase()
  if (cc === "ngn") return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
  return `${n.toLocaleString()} ${currency?.toUpperCase() ?? ""}`
}

const statusColor = (s: Entry["status"]): "green" | "grey" | "orange" => {
  if (s === "earned") return "green"
  if (s === "reversed") return "grey"
  return "orange"
}

const PAGE_SIZE = 25
const STATUSES = ["all", "pending", "earned", "reversed"] as const

const PartnerDetail = () => {
  const { id } = useParams<{ id: string }>()
  const [partner, setPartner] = useState<Partner | null>(null)
  const [list, setList] = useState<ListResp | null>(null)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("all")
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!id) return
    fetchAdmin<{ partner: Partner }>(`/admin/partners/${id}`)
      .then((d) => setPartner(d.partner))
      .catch(() => setPartner(null))
  }, [id])

  useEffect(() => {
    if (!id) return
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (statusFilter !== "all") params.set("status", statusFilter)
    fetchAdmin<ListResp>(`/admin/partners/${id}/commissions?${params}`)
      .then(setList)
      .catch(() => setList(null))
  }, [id, statusFilter, offset])

  const currency = list?.entries[0]?.currency_code ?? "ngn"

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  const summary = useMemo(() => {
    if (!list) return null
    return list.totals
  }, [list])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/settings/partners" className="text-sm text-ui-fg-muted hover:underline">Partners</Link>
            <span className="text-ui-fg-muted">/</span>
            <Heading>{partner?.name ?? "…"}</Heading>
            {partner && <Badge size="2xsmall">{partner.code}</Badge>}
            {partner && (
              <StatusBadge
                color={partner.status === "active" ? "green" : partner.status === "suspended" ? "red" : "grey"}
              >
                {partner.status}
              </StatusBadge>
            )}
          </div>
          {partner && (
            <Text size="small" className="text-ui-fg-muted mt-1">
              {TIER_LABELS[partner.tier] ?? partner.tier} · Rate {(partner.commission_rate * 100).toFixed(2)}%
              {partner.email ? ` · ${partner.email}` : ""}
              {partner.phone ? ` · ${partner.phone}` : ""}
            </Text>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-4 px-6 py-4">
          <div>
            <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wider">Eligible sales</Text>
            <Text size="large" weight="plus">{money(summary.eligible_amount, currency)}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wider">Pending</Text>
            <Text size="large" weight="plus">{money(summary.pending_amount, currency)}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wider">Earned</Text>
            <Text size="large" weight="plus">{money(summary.earned_amount, currency)}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wider">Net</Text>
            <Text size="large" weight="plus">{money(summary.net_amount, currency)}</Text>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setOffset(0) }}>
          <Select.Trigger className="w-36"><Select.Value /></Select.Trigger>
          <Select.Content>
            {STATUSES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
          </Select.Content>
        </Select>
      </div>

      <div className="px-6 pb-6">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Eligible</Table.HeaderCell>
              <Table.HeaderCell>Rate</Table.HeaderCell>
              <Table.HeaderCell>Commission</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list && list.entries.length > 0 ? (
              list.entries.map((e) => (
                <Table.Row key={e.id}>
                  <Table.Cell><Text size="xsmall">{new Date(e.created_at).toLocaleString()}</Text></Table.Cell>
                  <Table.Cell>
                    {e.order_display_id != null ? <Text size="small">#{e.order_display_id}</Text> : "—"}
                    <Text size="xsmall" className="text-ui-fg-muted">{e.order_id.slice(0, 12)}…</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{money(asNumber(e.eligible_amount), e.currency_code)}</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">{e.eligible_basis}</Text>
                  </Table.Cell>
                  <Table.Cell><Text size="small">{(e.commission_rate * 100).toFixed(2)}%</Text></Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">{money(asNumber(e.commission_amount), e.currency_code)}</Text>
                  </Table.Cell>
                  <Table.Cell><StatusBadge color={statusColor(e.status)}>{e.status}</StatusBadge></Table.Cell>
                  <Table.Cell><Text size="xsmall" className="text-ui-fg-muted">{e.reason ?? ""}</Text></Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row><Table.Cell><Text size="small" className="text-ui-fg-muted">No commission entries.</Text></Table.Cell></Table.Row>
            )}
          </Table.Body>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list ? `Showing ${list.entries.length === 0 ? 0 : offset + 1}–${offset + list.entries.length} of ${list.count}` : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Text size="small" className="text-ui-fg-muted">Page {page} of {totalPages}</Text>
            <Button size="small" variant="secondary" disabled={!list || offset + PAGE_SIZE >= list.count} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </div>
    </Container>
  )
}

export default PartnerDetail
