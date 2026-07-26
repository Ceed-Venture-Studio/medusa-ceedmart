import { defineRouteConfig } from "@medusajs/admin-sdk"
import { UsersSolid } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { fetchAdmin } from "../../../lib/client"

type Partner = {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  code: string
  commission_rate: number
  status: "active" | "inactive" | "suspended"
  notes: string | null
  created_at: string
  updated_at: string
}

type ListResp = { partners: Partner[]; count: number; limit: number; offset: number }

const PAGE_SIZE = 25
const STATUSES: Partner["status"][] = ["active", "inactive", "suspended"]

const statusColor = (s: Partner["status"]): "green" | "grey" | "red" => {
  if (s === "active") return "green"
  if (s === "suspended") return "red"
  return "grey"
}

const relative = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

type EditorMode = { kind: "create" } | { kind: "edit"; partner: Partner } | null

const PartnerEditor = ({
  mode,
  onClose,
  onSaved,
}: {
  mode: EditorMode
  onClose: () => void
  onSaved: () => void
}) => {
  const editing = mode?.kind === "edit" ? mode.partner : null
  const [name, setName] = useState(editing?.name ?? "")
  const [code, setCode] = useState(editing?.code ?? "")
  const [email, setEmail] = useState(editing?.email ?? "")
  const [phone, setPhone] = useState(editing?.phone ?? "")
  const [company, setCompany] = useState(editing?.company ?? "")
  const [ratePct, setRatePct] = useState(
    editing ? String(Math.round((editing.commission_rate ?? 0.07) * 10000) / 100) : "7"
  )
  const [status, setStatus] = useState<Partner["status"]>(editing?.status ?? "active")
  const [notes, setNotes] = useState(editing?.notes ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!mode) return
    if (mode.kind === "edit") {
      const p = mode.partner
      setName(p.name); setCode(p.code); setEmail(p.email ?? "")
      setPhone(p.phone ?? ""); setCompany(p.company ?? "")
      setRatePct(String(Math.round((p.commission_rate ?? 0.07) * 10000) / 100))
      setStatus(p.status); setNotes(p.notes ?? "")
    } else {
      setName(""); setCode(""); setEmail(""); setPhone(""); setCompany("")
      setRatePct("7"); setStatus("active"); setNotes("")
    }
  }, [mode])

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return }
    setSaving(true)
    try {
      const rate = Math.max(0, Math.min(100, Number(ratePct) || 0)) / 100
      if (editing) {
        await fetchAdmin<{ partner: Partner }>(`/admin/partners/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, email: email || null, phone: phone || null,
            company: company || null, commission_rate: rate,
            status, notes: notes || null,
          }),
        })
        toast.success("Partner updated")
      } else {
        await fetchAdmin<{ partner: Partner }>("/admin/partners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, email: email || null, phone: phone || null,
            company: company || null,
            code: code.trim() ? code.trim().toUpperCase() : undefined,
            commission_rate: rate, status, notes: notes || null,
          }),
        })
        toast.success("Partner created")
      }
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={!!mode} onOpenChange={(v) => { if (!v) onClose() }}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{editing ? "Edit partner" : "New partner"}</Drawer.Title>
          <Drawer.Description>
            {editing ? editing.id : "Create a partner and issue a referral code."}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Doe Distributors" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Code {editing && <span className="text-ui-fg-muted">(read-only)</span>}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Auto-generated if left blank"
                disabled={!!editing}
              />
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                Uppercase A–Z + 2–9. Shared as ?ref=CODE.
              </Text>
            </div>
            <div>
              <Label>Commission rate (%)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={ratePct}
                onChange={(e) => setRatePct(e.target.value)}
              />
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                Spec default is 7% for Partner tier.
              </Text>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Company (optional)</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Partner["status"])}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {STATUSES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
                </Select.Content>
              </Select>
            </div>
          </div>
          <div>
            <Label>Internal notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex w-full justify-end gap-2">
            <Drawer.Close asChild><Button variant="secondary">Cancel</Button></Drawer.Close>
            <Button onClick={save} isLoading={saving} disabled={saving || !name.trim()}>
              {editing ? "Save changes" : "Create partner"}
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const PartnersPage = () => {
  const [list, setList] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [offset, setOffset] = useState(0)
  const [editor, setEditor] = useState<EditorMode>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setOffset(0) }, [debouncedQ, statusFilter])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (debouncedQ) params.set("q", debouncedQ)
    if (statusFilter !== "all") params.set("status", statusFilter)
    fetchAdmin<ListResp>(`/admin/partners?${params}`)
      .then((d) => { if (!cancelled) setList(d) })
      .catch(() => { if (!cancelled) setList(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQ, statusFilter, offset, refreshTick])

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Partners</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Referral partners. Each has a unique code that attributes storefront orders and accrues commission (spec §6).
          </Text>
        </div>
        <Button size="small" onClick={() => setEditor({ kind: "create" })}>New partner</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="w-72">
          <Input placeholder="Filter by name / code / email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <Select.Trigger className="w-36"><Select.Value /></Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All statuses</Select.Item>
            {STATUSES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
          </Select.Content>
        </Select>
        <Button size="small" variant="secondary" onClick={() => setRefreshTick((n) => n + 1)}>Refresh</Button>
      </div>

      <div className="px-6 pb-6">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Code</Table.HeaderCell>
              <Table.HeaderCell>Rate</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Contact</Table.HeaderCell>
              <Table.HeaderCell>Created</Table.HeaderCell>
              <Table.HeaderCell></Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && !list ? (
              <Table.Row><Table.Cell><Text size="small" className="text-ui-fg-muted">Loading…</Text></Table.Cell></Table.Row>
            ) : list && list.partners.length > 0 ? (
              list.partners.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell>
                    <Link to={`/settings/partners/${p.id}`} className="hover:underline">
                      <Text size="small" weight="plus">{p.name}</Text>
                    </Link>
                    {p.company && <Text size="xsmall" className="text-ui-fg-muted">{p.company}</Text>}
                  </Table.Cell>
                  <Table.Cell><Badge size="2xsmall">{p.code}</Badge></Table.Cell>
                  <Table.Cell><Text size="small">{(p.commission_rate * 100).toFixed(2)}%</Text></Table.Cell>
                  <Table.Cell><StatusBadge color={statusColor(p.status)}>{p.status}</StatusBadge></Table.Cell>
                  <Table.Cell>
                    {p.email && <Text size="xsmall">{p.email}</Text>}
                    {p.phone && <Text size="xsmall" className="text-ui-fg-muted">{p.phone}</Text>}
                  </Table.Cell>
                  <Table.Cell><Text size="xsmall">{relative(p.created_at)}</Text></Table.Cell>
                  <Table.Cell>
                    <Button size="small" variant="secondary" onClick={() => setEditor({ kind: "edit", partner: p })}>Edit</Button>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row><Table.Cell><Text size="small" className="text-ui-fg-muted">No partners.</Text></Table.Cell></Table.Row>
            )}
          </Table.Body>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list ? `Showing ${list.partners.length === 0 ? 0 : offset + 1}–${offset + list.partners.length} of ${list.count}` : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button size="small" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Text size="small" className="text-ui-fg-muted">Page {page} of {totalPages}</Text>
            <Button size="small" variant="secondary" disabled={!list || offset + PAGE_SIZE >= list.count || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </div>

      <PartnerEditor
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={() => setRefreshTick((n) => n + 1)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Partners",
  icon: UsersSolid,
})

export default PartnersPage
