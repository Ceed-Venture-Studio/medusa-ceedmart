import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Tools } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// Custom-build operations (BRD §7.5–§7.10, §13).
//
// Three things a specialist does: read what a customer asked for, price it,
// and shepherd the machine through assembly and QA. The queue leads with
// requests waiting on US, because a request we have already answered is not
// work.

// ─── Types ────────────────────────────────────────────────────────────────

type QuoteSummary = {
  id: string
  reference: string
  status: string
  version_count: number
}

type BuildRequest = {
  id: string
  reference: string
  customer_name: string
  customer_email: string
  customer_phone: string | null
  delivery_state: string | null
  build_type: string
  intended_use: string
  budget_min: number | null
  budget_max: number | null
  required_software: string[] | null
  preferred_brands: string[] | null
  performance_notes: string | null
  portability_needs: string | null
  needed_by: string | null
  notes: string | null
  status: string
  created_at: string
  quote: QuoteSummary | null
  waiting_on_us: boolean
}

type QaSummary = {
  total: number
  required: number
  passed: number
  failed: number
  pending: number
  outstanding: string[]
  complete: boolean
}

type BuildOrder = {
  id: string
  reference: string
  status: string
  total: number
  currency_code: string
  build_days: number | null
  promised_ready_date: string | null
  qa_passed_at: string | null
  qa: QaSummary
}

type QaCheck = {
  id: string
  code: string
  label: string
  is_required: boolean
  result: string
  notes: string | null
  checked_by: string | null
}

type QuoteLine = {
  label: string
  description?: string
  quantity: number
  unit_price: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const naira = (kobo: number | null | undefined) =>
  kobo == null ? "—" : `₦${(Number(kobo) / 100).toLocaleString()}`

const label = (value: string) =>
  value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

const BUILD_STATUSES = [
  "parts_sourcing",
  "assembly",
  "quality_assurance",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
  "unable_to_fulfil",
]

// ─── Quote builder ────────────────────────────────────────────────────────

const QuoteDrawer = ({
  request,
  onClose,
  onSent,
}: {
  request: BuildRequest | null
  onClose: () => void
  onSent: () => void
}) => {
  const [lines, setLines] = useState<QuoteLine[]>([
    { label: "", quantity: 1, unit_price: 0 },
  ])
  const [buildDays, setBuildDays] = useState("5")
  const [warranty, setWarranty] = useState("12 months Ceedmart warranty")
  const [cancellation, setCancellation] = useState(
    "You can cancel free of charge until we buy the parts. After that, components we have already purchased for your build are non-refundable."
  )
  const [changeNote, setChangeNote] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLines([{ label: "", quantity: 1, unit_price: 0 }])
    setChangeNote("")
  }, [request?.id])

  if (!request) return null

  const setLine = (i: number, patch: Partial<QuoteLine>) =>
    setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const total = lines.reduce(
    (acc, l) => acc + Math.max(0, l.quantity) * Math.max(0, l.unit_price),
    0
  )

  const isRevision = (request.quote?.version_count ?? 0) > 0

  const send = async () => {
    const usable = lines.filter((l) => l.label.trim())
    if (!usable.length) {
      toast.error("Add at least one line")
      return
    }

    setBusy(true)
    try {
      await fetchAdmin(`/admin/builds/requests/${request.id}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_items: usable.map((l) => ({
            label: l.label.trim(),
            description: l.description?.trim() || undefined,
            quantity: l.quantity,
            // The form collects naira; everything server-side is kobo.
            unit_price: Math.round(l.unit_price * 100),
          })),
          build_days: Number(buildDays) || undefined,
          warranty_text: warranty.trim() || undefined,
          cancellation_terms: cancellation.trim() || undefined,
          change_note: changeNote.trim() || undefined,
          send: true,
        }),
      })
      toast.success(
        isRevision ? "Revised quote sent" : "Quote sent to the customer"
      )
      onSent()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not send the quote")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {isRevision ? "Revise quote" : "Quote"} · {request.reference}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="rounded-md bg-ui-bg-subtle p-3 flex flex-col gap-2">
            <Text size="small" weight="plus">
              {request.customer_name} · {label(request.build_type)}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {request.intended_use}
            </Text>
            <Text size="small" className="text-ui-fg-muted">
              Budget {naira(request.budget_min)} – {naira(request.budget_max)}
            </Text>
            {request.required_software?.length ? (
              <Text size="small" className="text-ui-fg-muted">
                Must run: {request.required_software.join(", ")}
              </Text>
            ) : null}
            {request.performance_notes && (
              <Text size="small" className="text-ui-fg-muted">
                {request.performance_notes}
              </Text>
            )}
            {request.notes && (
              <Text size="small" className="text-ui-fg-muted">
                Notes: {request.notes}
              </Text>
            )}
          </div>

          {isRevision && (
            <div className="flex flex-col gap-1">
              <Label size="small">What changed (shown to the customer)</Label>
              <Input
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="Swapped the GPU for a 4070 Super to stay in budget"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label size="small">Line items</Label>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_110px_32px] gap-2">
                <Input
                  value={line.label}
                  placeholder="Component or service"
                  onChange={(e) => setLine(i, { label: e.target.value })}
                />
                <Input
                  value={String(line.quantity)}
                  inputMode="numeric"
                  onChange={(e) =>
                    setLine(i, { quantity: Number(e.target.value) || 0 })
                  }
                />
                <Input
                  value={String(line.unit_price)}
                  inputMode="numeric"
                  placeholder="₦"
                  onChange={(e) =>
                    setLine(i, { unit_price: Number(e.target.value) || 0 })
                  }
                />
                <IconButton
                  variant="transparent"
                  onClick={() =>
                    setLines((rows) => rows.filter((_, idx) => idx !== i))
                  }
                >
                  ×
                </IconButton>
              </div>
            ))}
            <Button
              variant="secondary"
              size="small"
              onClick={() =>
                setLines((rows) => [...rows, { label: "", quantity: 1, unit_price: 0 }])
              }
            >
              Add line
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-ui-border-base pt-3">
            <Text size="small" className="text-ui-fg-muted">
              Total
            </Text>
            <Text weight="plus">₦{total.toLocaleString()}</Text>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">
                Build days
              </Text>
              <Input
                value={buildDays}
                inputMode="numeric"
                onChange={(e) => setBuildDays(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Warranty</Label>
            <Input value={warranty} onChange={(e) => setWarranty(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Cancellation terms</Label>
            <Textarea
              rows={3}
              value={cancellation}
              onChange={(e) => setCancellation(e.target.value)}
            />
            <Text size="small" className="text-ui-fg-muted">
              Shown in full on the quote page. This is the sentence a customer
              will quote back at us, so say plainly what happens to parts we
              have already bought.
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} isLoading={busy}>
            Send to customer
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── QA drawer ────────────────────────────────────────────────────────────

const QaDrawer = ({
  build,
  onClose,
  onChanged,
}: {
  build: BuildOrder | null
  onClose: () => void
  onChanged: () => void
}) => {
  const [checks, setChecks] = useState<QaCheck[] | null>(null)
  const [status, setStatus] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [noteFor, setNoteFor] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    if (!build) return
    fetchAdmin<{ checks: QaCheck[] }>(`/admin/builds/orders/${build.id}/qa`)
      .then((r) => setChecks(r.checks))
      .catch(() => setChecks([]))
  }, [build?.id])

  useEffect(() => {
    setChecks(null)
    setStatus("")
    setReason("")
    load()
  }, [build?.id, load])

  if (!build) return null

  const record = async (check: QaCheck, result: string) => {
    const notes = noteFor[check.code]?.trim()
    if ((result === "failed" || result === "not_applicable") && !notes) {
      toast.error(`Add a note before marking "${check.label}" as ${result}`)
      return
    }
    try {
      await fetchAdmin(`/admin/builds/orders/${build.id}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: check.code, result, notes }),
      })
      load()
      onChanged()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not record that check")
    }
  }

  const advance = async () => {
    if (!status) {
      toast.error("Choose a status")
      return
    }
    setBusy(true)
    try {
      await fetchAdmin(`/admin/builds/orders/${build.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() || undefined }),
      })
      toast.success(`Moved to ${label(status)}`)
      onChanged()
      onClose()
    } catch (err: any) {
      // The dispatch gate surfaces here: the server names which required
      // checks are outstanding rather than saying "QA incomplete".
      toast.error(err?.message ?? "Could not update this build")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{build.reference}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <Badge>{label(build.status)}</Badge>
            {build.qa_passed_at ? (
              <StatusBadge color="green">QA passed</StatusBadge>
            ) : (
              <StatusBadge color="orange">
                QA {build.qa.passed}/{build.qa.required}
              </StatusBadge>
            )}
          </div>

          <Text size="small" className="text-ui-fg-subtle">
            {naira(build.total)}
            {build.build_days ? ` · ${build.build_days} build days` : ""}
          </Text>

          <div className="flex flex-col gap-2 border-t border-ui-border-base pt-4">
            <Label size="small">Quality assurance</Label>
            {!checks ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading…
              </Text>
            ) : (
              checks.map((check) => (
                <div
                  key={check.id}
                  className="flex flex-col gap-1 border-b border-ui-border-base pb-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Text size="small">
                      {check.label}
                      {!check.is_required && (
                        <span className="text-ui-fg-muted"> (optional)</span>
                      )}
                    </Text>
                    <div className="flex gap-1">
                      {["passed", "failed", "not_applicable"].map((r) => (
                        <Button
                          key={r}
                          size="small"
                          variant={check.result === r ? "primary" : "transparent"}
                          onClick={() => record(check, r)}
                        >
                          {r === "passed" ? "✓" : r === "failed" ? "✗" : "n/a"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {check.notes ? (
                    <Text size="small" className="text-ui-fg-muted">
                      {check.notes} {check.checked_by ? `— ${check.checked_by}` : ""}
                    </Text>
                  ) : (
                    <Input
                      placeholder="Note (required to fail or skip)"
                      value={noteFor[check.code] ?? ""}
                      onChange={(e) =>
                        setNoteFor((n) => ({ ...n, [check.code]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-ui-border-base pt-4">
            <Label size="small">Move build to</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger>
                <Select.Value placeholder="Choose a status" />
              </Select.Trigger>
              <Select.Content>
                {BUILD_STATUSES.map((s) => (
                  <Select.Item key={s} value={s}>
                    {label(s)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Input
              placeholder="Reason (required for exceptions)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button onClick={advance} isLoading={busy}>
              Update build
            </Button>
            {!build.qa.complete && build.qa.outstanding.length > 0 && (
              <Text size="small" className="text-ui-fg-muted">
                Dispatch is blocked until {build.qa.outstanding.length} required
                check{build.qa.outstanding.length === 1 ? "" : "s"} pass.
              </Text>
            )}
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const BuildsPage = () => {
  const [requests, setRequests] = useState<BuildRequest[] | null>(null)
  const [builds, setBuilds] = useState<BuildOrder[] | null>(null)
  const [quoting, setQuoting] = useState<BuildRequest | null>(null)
  const [openBuild, setOpenBuild] = useState<BuildOrder | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setError(null)

    Promise.all([
      fetchAdmin<{ requests: BuildRequest[] }>("/admin/builds/requests"),
      fetchAdmin<{ builds: BuildOrder[] }>("/admin/builds/orders"),
    ])
      .then(([r, b]) => {
        if (cancelled) return
        setRequests(r.requests)
        setBuilds(b.builds)
      })
      .catch((err) => !cancelled && setError(err?.message ?? "Could not load"))

    return () => {
      cancelled = true
    }
  }, [tick])

  const waiting = (requests ?? []).filter((r) => r.waiting_on_us).length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Custom Builds</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {waiting > 0
              ? `${waiting} request${waiting === 1 ? "" : "s"} waiting on us`
              : "Nothing waiting on us"}
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={reload}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      )}

      <div className="px-6 py-4">
        <Tabs defaultValue="requests">
          <Tabs.List>
            <Tabs.Trigger value="requests">Requests</Tabs.Trigger>
            <Tabs.Trigger value="builds">In build</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="requests" className="pt-4">
            {!requests ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading…
              </Text>
            ) : requests.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                No build requests yet.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Ref</Table.HeaderCell>
                    <Table.HeaderCell>Customer</Table.HeaderCell>
                    <Table.HeaderCell>Wants</Table.HeaderCell>
                    <Table.HeaderCell>Budget</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                    <Table.HeaderCell>&nbsp;</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {requests.map((r) => (
                    <Table.Row key={r.id}>
                      <Table.Cell>
                        <Text size="small" className="font-mono">
                          {r.reference}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="small">{r.customer_name}</Text>
                        <Text size="small" className="text-ui-fg-muted">
                          {r.customer_email}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="small">{label(r.build_type)}</Text>
                        <Text size="small" className="text-ui-fg-muted">
                          {r.intended_use}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        {naira(r.budget_min)} – {naira(r.budget_max)}
                      </Table.Cell>
                      <Table.Cell>
                        {r.waiting_on_us ? (
                          <StatusBadge color="orange">{label(r.status)}</StatusBadge>
                        ) : (
                          <StatusBadge color="grey">{label(r.status)}</StatusBadge>
                        )}
                        {r.quote && (
                          <Text size="small" className="text-ui-fg-muted">
                            {r.quote.reference} v{r.quote.version_count}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Button size="small" onClick={() => setQuoting(r)}>
                          {r.quote?.version_count ? "Revise" : "Quote"}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>

          <Tabs.Content value="builds" className="pt-4">
            {!builds ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading…
              </Text>
            ) : builds.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                No accepted builds yet.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Ref</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                    <Table.HeaderCell>Value</Table.HeaderCell>
                    <Table.HeaderCell>QA</Table.HeaderCell>
                    <Table.HeaderCell>&nbsp;</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {builds.map((b) => (
                    <Table.Row
                      key={b.id}
                      className="cursor-pointer"
                      onClick={() => setOpenBuild(b)}
                    >
                      <Table.Cell>
                        <Text size="small" className="font-mono">
                          {b.reference}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>{label(b.status)}</Table.Cell>
                      <Table.Cell>{naira(b.total)}</Table.Cell>
                      <Table.Cell>
                        {b.qa.complete ? (
                          <StatusBadge color="green">Passed</StatusBadge>
                        ) : (
                          <StatusBadge color={b.qa.failed ? "red" : "orange"}>
                            {b.qa.passed}/{b.qa.required}
                          </StatusBadge>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Button size="small" variant="secondary">
                          Open
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>
        </Tabs>
      </div>

      <QuoteDrawer
        request={quoting}
        onClose={() => setQuoting(null)}
        onSent={reload}
      />
      <QaDrawer
        build={openBuild}
        onClose={() => setOpenBuild(null)}
        onChanged={reload}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Custom Builds",
  icon: Tools,
})

export default BuildsPage
