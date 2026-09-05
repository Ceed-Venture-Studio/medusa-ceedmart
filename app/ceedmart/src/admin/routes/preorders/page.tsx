import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
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
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// US pre-order operations (BRD §6.4, §6.5, §13).
//
// Two jobs on one screen, because they are two halves of the same
// responsibility: OFFERS is what we are willing to source and at what
// price; QUEUE is what customers have actually paid for and where it is.
//
// The queue leads with exceptions and overdue orders rather than newest
// first. §6.5 requires a delayed or unavailable order to enter an exception
// workflow and "cannot appear as normally progressing" — a list sorted by
// date buries exactly the rows that need a human.

// ─── Types ────────────────────────────────────────────────────────────────

type Estimate = {
  procurementDays: number
  transitDays: number
  customsDays: number
  totalDays: number
  isOverridden: boolean
}

type Offer = {
  id: string
  product_id: string | null
  variant_id: string | null
  supplier_id: string | null
  locked_price: number
  currency_code: string
  condition: string
  is_active: boolean
  availability_verified_at: string | null
  offer_expires_at: string | null
  procurement_days: number
  transit_days: number
  customs_days: number
  total_days_override: number | null
  warranty_text: string | null
  return_policy_text: string | null
  estimate: Estimate
  margin: { amount: number; rate: number }
  drift: { suggested: number; deltaKobo: number; deltaRate: number }
}

type Preorder = {
  id: string
  order_display_id: number | null
  order_id: string
  status: string
  customer_stage: string
  unit_price: number
  quantity: number
  currency_code: string
  promised_delivery_date: string | null
  estimate_days: number | null
  carrier: string | null
  tracking_reference: string | null
  exception_reason: string | null
  is_exception: boolean
  is_overdue: boolean
  is_paused: boolean
  paused_days: number
}

type Supplier = { id: string; name: string; country_code: string }

// ─── Helpers ──────────────────────────────────────────────────────────────

const naira = (kobo: number | null | undefined) =>
  kobo == null ? "—" : `₦${(Number(kobo) / 100).toLocaleString()}`

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "—"

// Milestones an operator can move an order to, in the order they happen.
// Mirrors preorderMachine; the server rejects anything illegal, so this is a
// convenience list rather than the rule.
const MILESTONES = [
  "availability_check",
  "sourcing_confirmed",
  "purchased",
  "at_us_facility",
  "in_international_transit",
  "customs_clearance",
  "at_nigeria_facility",
  "out_for_delivery",
  "delivered",
  "delivery_exception",
  "unable_to_source",
]

const REFUND_REASONS = [
  "customer_changed_mind",
  "unable_to_source",
  "price_increase_rejected",
  "substitution_rejected",
  "delivery_failed",
  "item_damaged",
  "duplicate_order",
  "goodwill",
]

const label = (value: string) =>
  value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

// ─── Offer drawer ─────────────────────────────────────────────────────────

const OfferDrawer = ({
  open,
  suppliers,
  onClose,
  onSaved,
}: {
  open: boolean
  suppliers: Supplier[]
  onClose: () => void
  onSaved: () => void
}) => {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({
    variant_id: "",
    product_id: "",
    supplier_id: "",
    price_naira: "",
    procurement_days: "3",
    transit_days: "7",
    customs_days: "4",
    condition: "new",
    warranty_text: "",
    return_policy_text: "",
    source_price_cents: "",
    fx_rate: "",
    freight_naira: "",
    duty_naira: "",
    margin_naira: "",
  })

  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const num = (key: string) => {
    const n = Number(form[key])
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const kobo = (key: string) => {
    const n = num(key)
    return n ? Math.round(n * 100) : undefined
  }

  const estimateTotal =
    (Number(form.procurement_days) || 0) +
    (Number(form.transit_days) || 0) +
    (Number(form.customs_days) || 0)

  const save = async () => {
    if (!form.variant_id.trim() && !form.product_id.trim()) {
      toast.error("Give either a variant ID or a product ID")
      return
    }
    if (!kobo("price_naira")) {
      toast.error("A locked price is required")
      return
    }

    setSaving(true)
    try {
      await fetchAdmin("/admin/preorders/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant_id: form.variant_id.trim() || undefined,
          product_id: form.variant_id.trim()
            ? undefined
            : form.product_id.trim() || undefined,
          supplier_id: form.supplier_id || undefined,
          locked_price: kobo("price_naira"),
          procurement_days: Number(form.procurement_days) || 0,
          transit_days: Number(form.transit_days) || 0,
          customs_days: Number(form.customs_days) || 0,
          condition: form.condition,
          warranty_text: form.warranty_text.trim() || undefined,
          return_policy_text: form.return_policy_text.trim() || undefined,
          fx_rate: num("fx_rate"),
          cost_components: {
            source_price: num("source_price_cents"),
            fx_rate: num("fx_rate"),
            freight: kobo("freight_naira"),
            duty: kobo("duty_naira"),
            margin: kobo("margin_naira"),
          },
        }),
      })
      toast.success("Offer created as a draft — confirm availability to publish it")
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create the offer")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New pre-order offer</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <Label size="small">Variant ID</Label>
            <Input
              value={form.variant_id}
              onChange={(e) => set("variant_id", e.target.value)}
              placeholder="variant_01H…"
            />
            <Text size="small" className="text-ui-fg-muted">
              Or leave blank and give a product ID below to cover every variant.
            </Text>
            <Input
              value={form.product_id}
              onChange={(e) => set("product_id", e.target.value)}
              placeholder="prod_01H…"
              disabled={!!form.variant_id.trim()}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">Supplier</Label>
            <Select value={form.supplier_id} onValueChange={(v) => set("supplier_id", v)}>
              <Select.Trigger>
                <Select.Value placeholder="Choose a supplier" />
              </Select.Trigger>
              <Select.Content>
                {suppliers.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">Locked price the customer pays (₦)</Label>
            <Input
              value={form.price_naira}
              onChange={(e) => set("price_naira", e.target.value)}
              placeholder="468000"
              inputMode="numeric"
            />
            <Text size="small" className="text-ui-fg-muted">
              All-inclusive. The customer is never asked to top up.
            </Text>
          </div>

          <div>
            <Label size="small">Delivery window (calendar days)</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                ["procurement_days", "Sourcing"],
                ["transit_days", "Transit"],
                ["customs_days", "Customs"],
              ].map(([key, name]) => (
                <div key={key} className="flex flex-col gap-1">
                  <Text size="small" className="text-ui-fg-muted">
                    {name}
                  </Text>
                  <Input
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>
            <Text size="small" className="text-ui-fg-subtle mt-2">
              Customer sees <strong>{estimateTotal} days</strong>. Tune each leg
              per supplier as real delivery data comes in.
            </Text>
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">Condition</Label>
            <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {["new", "open_box", "refurbished", "used"].map((c) => (
                  <Select.Item key={c} value={c}>
                    {label(c)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">Warranty</Label>
            <Textarea
              rows={2}
              value={form.warranty_text}
              onChange={(e) => set("warranty_text", e.target.value)}
              placeholder="12 months Ceedmart warranty"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">Return policy</Label>
            <Textarea
              rows={2}
              value={form.return_policy_text}
              onChange={(e) => set("return_policy_text", e.target.value)}
            />
          </div>

          <div className="border-t border-ui-border-base pt-4">
            <Text size="small" weight="plus">
              Cost breakdown (internal only)
            </Text>
            <Text size="small" className="text-ui-fg-muted mb-3">
              Never shown to customers. Used for margin reporting and to flag
              offers left behind by an FX move.
            </Text>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["source_price_cents", "Source price (US cents)"],
                ["fx_rate", "FX rate (₦ per $)"],
                ["freight_naira", "Freight (₦)"],
                ["duty_naira", "Duty (₦)"],
                ["margin_naira", "Margin (₦)"],
              ].map(([key, name]) => (
                <div key={key} className="flex flex-col gap-1">
                  <Text size="small" className="text-ui-fg-muted">
                    {name}
                  </Text>
                  <Input
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving}>
            Create draft
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Milestone drawer ─────────────────────────────────────────────────────

const MilestoneDrawer = ({
  preorder,
  onClose,
  onChanged,
}: {
  preorder: Preorder | null
  onClose: () => void
  onChanged: () => void
}) => {
  const [status, setStatus] = useState("")
  const [reason, setReason] = useState("")
  const [carrier, setCarrier] = useState("")
  const [tracking, setTracking] = useState("")
  const [customerNote, setCustomerNote] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setStatus("")
    setReason("")
    setCarrier(preorder?.carrier ?? "")
    setTracking(preorder?.tracking_reference ?? "")
    setCustomerNote("")
    setRefundReason("")
  }, [preorder?.id])

  if (!preorder) return null

  const advance = async () => {
    if (!status) {
      toast.error("Choose a milestone")
      return
    }
    setBusy(true)
    try {
      await fetchAdmin(`/admin/preorders/${preorder.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reason: reason.trim() || undefined,
          carrier: carrier.trim() || undefined,
          tracking_reference: tracking.trim() || undefined,
          customer_note: customerNote.trim() || undefined,
        }),
      })
      toast.success(`Moved to ${label(status)} — customer notified`)
      onChanged()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update this pre-order")
    } finally {
      setBusy(false)
    }
  }

  const refund = async () => {
    if (!refundReason) {
      toast.error("Choose a refund reason")
      return
    }
    setBusy(true)
    try {
      await fetchAdmin(`/admin/preorders/${preorder.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason_code: refundReason,
          note: reason.trim() || undefined,
        }),
      })
      toast.success("Refund recorded — disburse it in the payment provider")
      onChanged()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not record the refund")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            Order #{preorder.order_display_id ?? "—"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <Badge>{label(preorder.status)}</Badge>
            {preorder.is_overdue && <StatusBadge color="red">Overdue</StatusBadge>}
            {preorder.is_paused && (
              <StatusBadge color="orange">
                Paused {preorder.paused_days}d
              </StatusBadge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              ["Customer sees", preorder.customer_stage],
              ["Value", naira(preorder.unit_price * preorder.quantity)],
              ["Promised", shortDate(preorder.promised_delivery_date)],
              ["Window", preorder.estimate_days ? `${preorder.estimate_days} days` : "—"],
            ].map(([k, v]) => (
              <div key={k as string}>
                <Text size="small" className="text-ui-fg-muted">
                  {k}
                </Text>
                <Text size="small">{v}</Text>
              </div>
            ))}
          </div>

          {preorder.exception_reason && (
            <div className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
              <Text size="small" weight="plus">
                Exception
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                {preorder.exception_reason}
              </Text>
            </div>
          )}

          <div className="border-t border-ui-border-base pt-4 flex flex-col gap-3">
            <Label size="small">Move to milestone</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger>
                <Select.Value placeholder="Choose a milestone" />
              </Select.Trigger>
              <Select.Content>
                {MILESTONES.map((m) => (
                  <Select.Item key={m} value={m}>
                    {label(m)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Text size="small" className="text-ui-fg-muted">
                  Carrier
                </Text>
                <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Text size="small" className="text-ui-fg-muted">
                  Tracking ref
                </Text>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">
                Note to the customer (optional)
              </Text>
              <Textarea
                rows={2}
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder="Goes into the email instead of our standard wording."
              />
            </div>

            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">
                Reason — required for exceptions
              </Text>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <Button onClick={advance} isLoading={busy}>
              Update milestone
            </Button>
          </div>

          <div className="border-t border-ui-border-base pt-4 flex flex-col gap-3">
            <Label size="small">Record a refund</Label>
            <Select value={refundReason} onValueChange={setRefundReason}>
              <Select.Trigger>
                <Select.Value placeholder="Reason code" />
              </Select.Trigger>
              <Select.Content>
                {REFUND_REASONS.map((r) => (
                  <Select.Item key={r} value={r}>
                    {label(r)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Text size="small" className="text-ui-fg-muted">
              Records the decision only. Money still has to be disbursed in the
              payment provider.
            </Text>
            <Button variant="danger" onClick={refund} isLoading={busy}>
              Record refund
            </Button>
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const PreordersPage = () => {
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [queue, setQueue] = useState<Preorder[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openPreorder, setOpenPreorder] = useState<Preorder | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setError(null)

    Promise.all([
      fetchAdmin<{ offers: Offer[] }>("/admin/preorders/offers"),
      fetchAdmin<{ preorders: Preorder[] }>("/admin/preorders"),
      fetchAdmin<{ suppliers: Supplier[] }>("/admin/preorders/suppliers"),
    ])
      .then(([o, q, s]) => {
        if (cancelled) return
        setOffers(o.offers)
        setQueue(q.preorders)
        setSuppliers(s.suppliers)
      })
      .catch((err) => !cancelled && setError(err?.message ?? "Could not load"))

    return () => {
      cancelled = true
    }
  }, [tick])

  const publish = async (offer: Offer) => {
    try {
      await fetchAdmin(`/admin/preorders/offers/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          offer.is_active
            ? { is_active: false }
            : // Publishing requires a confirmed availability check, so
              // confirm and publish in one action from here.
              { availability_verified: true, is_active: true }
        ),
      })
      toast.success(offer.is_active ? "Offer unpublished" : "Availability confirmed and published")
      reload()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update the offer")
    }
  }

  const needsAttention = useMemo(
    () => (queue ?? []).filter((p) => p.is_exception || p.is_overdue).length,
    [queue]
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">US Pre-Orders</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {needsAttention > 0
              ? `${needsAttention} order${needsAttention === 1 ? "" : "s"} need attention`
              : "Nothing needs attention"}
          </Text>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={reload}>
            <ArrowPath /> Refresh
          </Button>
          <Button size="small" onClick={() => setDrawerOpen(true)}>
            New offer
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      )}

      <div className="px-6 py-4">
        <Tabs defaultValue="queue">
          <Tabs.List>
            <Tabs.Trigger value="queue">Queue</Tabs.Trigger>
            <Tabs.Trigger value="offers">Offers</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="queue" className="pt-4">
            {!queue ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading…
              </Text>
            ) : queue.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                No pre-orders yet.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Order</Table.HeaderCell>
                    <Table.HeaderCell>Stage</Table.HeaderCell>
                    <Table.HeaderCell>Value</Table.HeaderCell>
                    <Table.HeaderCell>Promised</Table.HeaderCell>
                    <Table.HeaderCell>Flags</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {queue.map((p) => (
                    <Table.Row
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setOpenPreorder(p)}
                    >
                      <Table.Cell>#{p.order_display_id ?? "—"}</Table.Cell>
                      <Table.Cell>
                        <Text size="small">{label(p.status)}</Text>
                        <Text size="small" className="text-ui-fg-muted">
                          {p.customer_stage}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>{naira(p.unit_price * p.quantity)}</Table.Cell>
                      <Table.Cell>{shortDate(p.promised_delivery_date)}</Table.Cell>
                      <Table.Cell>
                        <div className="flex gap-1">
                          {p.is_exception && <StatusBadge color="red">Exception</StatusBadge>}
                          {p.is_overdue && <StatusBadge color="orange">Overdue</StatusBadge>}
                          {p.is_paused && <StatusBadge color="grey">Paused</StatusBadge>}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>

          <Tabs.Content value="offers" className="pt-4">
            {!offers ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading…
              </Text>
            ) : offers.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                No offers yet. Create one to start selling a US pre-order.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Listing</Table.HeaderCell>
                    <Table.HeaderCell>Price</Table.HeaderCell>
                    <Table.HeaderCell>Window</Table.HeaderCell>
                    <Table.HeaderCell>Margin</Table.HeaderCell>
                    <Table.HeaderCell>State</Table.HeaderCell>
                    <Table.HeaderCell>&nbsp;</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {offers.map((o) => {
                    // Flag an offer whose components have moved more than 5%
                    // from its locked price — an FX swing that nobody has
                    // re-priced against is how we sell below cost.
                    const drifted = Math.abs(o.drift.deltaRate) > 0.05
                    return (
                      <Table.Row key={o.id}>
                        <Table.Cell>
                          <Text size="small" className="font-mono">
                            {o.variant_id ?? o.product_id}
                          </Text>
                          <Text size="small" className="text-ui-fg-muted">
                            {label(o.condition)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="small">{naira(o.locked_price)}</Text>
                          {drifted && (
                            <Text size="small" className="text-ui-fg-error">
                              Cost moved — suggest {naira(o.drift.suggested)}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>{o.estimate.totalDays} days</Table.Cell>
                        <Table.Cell>
                          <Text
                            size="small"
                            className={o.margin.amount < 0 ? "text-ui-fg-error" : ""}
                          >
                            {naira(o.margin.amount)} ({pct(o.margin.rate)})
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          {o.is_active ? (
                            <StatusBadge color="green">Live</StatusBadge>
                          ) : (
                            <StatusBadge color="grey">Draft</StatusBadge>
                          )}
                          {!o.availability_verified_at && (
                            <Text size="small" className="text-ui-fg-muted">
                              Unverified
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            size="small"
                            variant={o.is_active ? "secondary" : "primary"}
                            onClick={() => publish(o)}
                          >
                            {o.is_active ? "Unpublish" : "Verify & publish"}
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>
        </Tabs>
      </div>

      <OfferDrawer
        open={drawerOpen}
        suppliers={suppliers}
        onClose={() => setDrawerOpen(false)}
        onSaved={reload}
      />
      <MilestoneDrawer
        preorder={openPreorder}
        onClose={() => setOpenPreorder(null)}
        onChanged={reload}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Pre-Orders",
  icon: ArrowPath,
})

export default PreordersPage
