import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, PencilSquare, Trash } from "@medusajs/icons"
import {
  Badge,
  IconButton,
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
import ProductPicker, {
  type ProductSelection,
} from "../../components/product-picker"

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
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  supplier_id: string | null
  locked_price: number
  // Returned by the list route (it spreads the whole offer) but previously
  // undeclared, so nothing could read them. The edit form needs both.
  cost_components: Record<string, number | null> | null
  fx_rate: number | null
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

type Supplier = {
  id: string
  name: string
  country_code: string
  reference: string | null
  contact_email: string | null
  is_active: boolean
}

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

const BLANK_FORM: Record<string, string> = {
    supplier_id: "",
    price_naira: "",
    procurement_days: "3",
    transit_days: "7",
    customs_days: "4",
    condition: "new",
    warranty_text: "",
    return_policy_text: "",
    offer_expires_on: "",
    source_price_cents: "",
    fx_rate: "",
    freight_naira: "",
    duty_naira: "",
    margin_naira: "",
}

const OfferDrawer = ({
  open,
  offer,
  suppliers,
  onClose,
  onSaved,
  onSuppliersChanged,
}: {
  open: boolean
  /** Editing when present, creating when null. One drawer for both: the
   *  fields are identical, and a second copy would drift from this one. */
  offer: Offer | null
  suppliers: Supplier[]
  onClose: () => void
  onSaved: () => void
  onSuppliersChanged: () => void
}) => {
  const [saving, setSaving] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    reference: "",
    contact_email: "",
  })
  const [listing, setListing] = useState<ProductSelection>({
    productId: null,
    variantId: null,
    label: "",
  })
  const [form, setForm] = useState<Record<string, string>>(BLANK_FORM)

  // What the catalogue charges for this variant, in naira. Shown beside the
  // offer price so nobody sets a pre-order price without knowing what the
  // same item sells for on the shelf.
  const [catalogPrice, setCatalogPrice] = useState<number | null>(null)

  // Prefill when editing; clear when creating.
  //
  // Keyed on the offer id as well as `open`, or opening a second offer would
  // still show the first one's figures.
  useEffect(() => {
    if (!open) {
      return
    }
    if (!offer) {
      setForm(BLANK_FORM)
      setListing({ productId: null, variantId: null, label: "" })
      setCatalogPrice(null)
      return
    }

    const cost = (offer.cost_components ?? {}) as Record<string, number | null>
    setForm({
      supplier_id: offer.supplier_id ?? "",
      price_naira: offer.locked_price ? String(offer.locked_price / 100) : "",
      procurement_days: String(offer.procurement_days ?? 3),
      transit_days: String(offer.transit_days ?? 7),
      customs_days: String(offer.customs_days ?? 4),
      condition: offer.condition ?? "new",
      warranty_text: offer.warranty_text ?? "",
      return_policy_text: offer.return_policy_text ?? "",
      offer_expires_on: offer.offer_expires_at
        ? new Date(offer.offer_expires_at).toISOString().slice(0, 10)
        : "",
      source_price_cents:
        cost.source_price != null ? String(cost.source_price) : "",
      fx_rate: offer.fx_rate != null ? String(offer.fx_rate) : "",
      freight_naira: cost.freight != null ? String(cost.freight / 100) : "",
      duty_naira: cost.duty != null ? String(cost.duty / 100) : "",
      margin_naira: cost.margin != null ? String(cost.margin / 100) : "",
    })

    // The picker shows a label, so name the variant too — "Deye Inverter"
    // and "Deye Inverter · 6kW" are different things to price.
    setListing({
      productId: offer.product_id ?? null,
      variantId: offer.variant_id ?? null,
      label: [offer.product_title, offer.variant_title]
        .filter(Boolean)
        .join(" · "),
    })
  }, [open, offer?.id])

  // Look up what the catalogue charges for the selected listing.
  //
  // Queries the VARIANT, not the product: an offer usually stores only a
  // variant_id — product_id is null on every one of ours — so going via the
  // product would find nothing to look up. The variant endpoint returns its
  // prices and its product in a single call either way.
  //
  // On create this also SEEDS the offer price. A pre-order is the same item
  // with a longer wait, so the shelf price is the honest starting point, and
  // retyping it from memory is how the two quietly drift apart.
  useEffect(() => {
    const { productId, variantId } = listing
    if (!open || (!productId && !variantId)) {
      setCatalogPrice(null)
      return
    }

    let cancelled = false

    const lookup = variantId
      ? fetchAdmin<{ variants: any[] }>(
          `/admin/product-variants?id=${variantId}&fields=id,product_id,*prices`
        ).then((r) => (r?.variants ?? [])[0])
      : fetchAdmin<{ product: any }>(
          `/admin/products/${productId}?fields=*variants.prices`
        ).then((r) => (r?.product?.variants ?? [])[0])

    lookup
      .then((variant: any) => {
        if (cancelled) return
        const ngn = (variant?.prices ?? []).find(
          (x: any) => String(x.currency_code).toLowerCase() === "ngn"
        )
        const amount = ngn?.amount ?? null
        setCatalogPrice(amount)

        // Never overwrite something already typed, and never touch the agreed
        // price on an existing offer.
        if (amount != null && !offer) {
          setForm((f) =>
            f.price_naira ? f : { ...f, price_naira: String(amount) }
          )
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogPrice(null)
      })

    return () => {
      cancelled = true
    }
  }, [open, listing.productId, listing.variantId, offer?.id])

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

  const createSupplier = async () => {
    if (!newSupplier.name.trim()) {
      toast.error("Give the supplier a name")
      return
    }
    setSavingSupplier(true)
    try {
      const res = await fetchAdmin<{ supplier: Supplier }>(
        "/admin/preorders/suppliers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newSupplier.name.trim(),
            reference: newSupplier.reference.trim() || undefined,
            contact_email: newSupplier.contact_email.trim() || undefined,
          }),
        }
      )
      // Select it immediately — you created it because you wanted it on
      // this offer.
      set("supplier_id", res.supplier.id)
      setNewSupplier({ name: "", reference: "", contact_email: "" })
      setAddingSupplier(false)
      onSuppliersChanged()
      toast.success(`${res.supplier.name} added`)
    } catch (err: any) {
      toast.error(err?.message ?? "Could not add that supplier")
    } finally {
      setSavingSupplier(false)
    }
  }

  const save = async () => {
    if (!listing.productId && !listing.variantId) {
      toast.error("Choose the product this offer prices")
      return
    }
    if (!kobo("price_naira")) {
      toast.error("A locked price is required")
      return
    }

    setSaving(true)
    try {
      // PATCH when editing. The listing itself is not editable — an offer is
      // a commercial wrapper around one variant, and repointing it at another
      // would silently change what a customer was quoted on.
      await fetchAdmin(
        offer ? `/admin/preorders/offers/${offer.id}` : "/admin/preorders/offers",
        {
        method: offer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(offer
            ? {}
            : {
                variant_id: listing.variantId ?? undefined,
                product_id: listing.variantId
                  ? undefined
                  : listing.productId ?? undefined,
              }),
          supplier_id: form.supplier_id || undefined,
          locked_price: kobo("price_naira"),
          procurement_days: Number(form.procurement_days) || 0,
          transit_days: Number(form.transit_days) || 0,
          customs_days: Number(form.customs_days) || 0,
          condition: form.condition,
          // End of the chosen day: an offer expiring "on the 14th" should be
          // buyable throughout the 14th, not dead as it begins.
          // Blank means "no expiry" when editing, so send null to clear it.
          // undefined would be dropped by JSON.stringify and the old date
          // would survive a deliberate clearing.
          offer_expires_at: form.offer_expires_on
            ? new Date(`${form.offer_expires_on}T23:59:59`).toISOString()
            : offer
              ? null
              : undefined,
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
      toast.success(
        offer
          ? "Offer updated"
          : "Offer created as a draft — confirm availability to publish it"
      )
      setListing({ productId: null, variantId: null, label: "" })
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
          <Drawer.Title>
            {offer ? "Edit pre-order offer" : "New pre-order offer"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <ProductPicker
            value={listing}
            onChange={setListing}
            helpText="An offer prices a listing you already sell. Create the product first, then attach the pre-order terms here."
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label size="small">Supplier</Label>
              <button
                type="button"
                onClick={() => setAddingSupplier((v) => !v)}
                className="txt-small text-ui-fg-interactive underline"
              >
                {addingSupplier ? "Cancel" : "+ New supplier"}
              </button>
            </div>

            {addingSupplier ? (
              // Inline rather than a separate screen: you discover you need
              // a supplier halfway through pricing an offer, and being sent
              // elsewhere means losing everything typed so far.
              <div className="flex flex-col gap-2 rounded-md border border-ui-border-base p-3">
                <Input
                  value={newSupplier.name}
                  onChange={(e) =>
                    setNewSupplier((n) => ({ ...n, name: e.target.value }))
                  }
                  placeholder="Supplier name (e.g. B&H Photo)"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newSupplier.reference}
                    onChange={(e) =>
                      setNewSupplier((n) => ({ ...n, reference: e.target.value }))
                    }
                    placeholder="Account / reference"
                  />
                  <Input
                    value={newSupplier.contact_email}
                    onChange={(e) =>
                      setNewSupplier((n) => ({
                        ...n,
                        contact_email: e.target.value,
                      }))
                    }
                    placeholder="Contact email"
                  />
                </div>
                <Button size="small" onClick={createSupplier} isLoading={savingSupplier}>
                  Add supplier
                </Button>
              </div>
            ) : suppliers.length === 0 ? (
              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                <Text size="small" className="text-ui-fg-muted">
                  No suppliers yet. Add the one you buy this from — it&apos;s how
                  you find out later whose items actually arrive on time.
                </Text>
              </div>
            ) : (
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
            )}
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
            {(listing.productId || listing.variantId) && (
              <Text size="small" className="text-ui-fg-subtle">
                {catalogPrice != null ? (
                  <>
                    Catalogue price {naira(catalogPrice * 100)}
                    {form.price_naira &&
                      Number(form.price_naira) !== catalogPrice && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => set("price_naira", String(catalogPrice))}
                          >
                            use it
                          </button>
                        </>
                      )}
                  </>
                ) : (
                  // Worth saying out loud: a variant with no price cannot be
                  // sold normally either, so this usually means the listing
                  // is incomplete rather than that the lookup failed.
                  "This variant has no catalogue price set."
                )}
              </Text>
            )}
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
            <Label size="small">Offer expires (optional)</Label>
            <Input
              type="date"
              value={form.offer_expires_on}
              onChange={(e) => set("offer_expires_on", e.target.value)}
            />
            <Text size="small" className="text-ui-fg-subtle">
              After this date the offer stops being sellable. Separate from the
              availability check, which expires on its own after a week —
              this is for a price or supplier commitment with an end date.
            </Text>
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
            {!offer
              ? "Create draft"
              : offer.is_active
                ? // A live offer is not a draft, and saying so would suggest
                  // the edit is parked somewhere rather than changing what
                  // customers see right now.
                  "Save changes"
                : "Save draft"}
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
  // Which offer the drawer is editing. null means it is creating one.
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null)
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

  // How long a confirmation stays good. Mirrors the store route's
  // PREORDER_MAX_VERIFICATION_AGE_DAYS, which refuses to sell past it — this
  // is the number that decides whether a live offer is actually buyable.
  const VERIFICATION_MAX_DAYS = 7

  const daysSince = (iso: string | null): number | null => {
    if (!iso) return null
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  }

  const patchOffer = async (offer: Offer, body: Record<string, unknown>, ok: string) => {
    try {
      await fetchAdmin(`/admin/preorders/offers/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      toast.success(ok)
      reload()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update the offer")
    }
  }

  // Re-confirming is its own action, deliberately.
  //
  // A confirmation goes stale after VERIFICATION_MAX_DAYS and the offer stops
  // being sellable — quietly, from the shop's point of view. Publishing was
  // the only thing that stamped a new check, so refreshing one meant
  // unpublishing and republishing: an action that reads like taking the
  // product down, to do something that is really "yes, the supplier still
  // has it".
  const removeOffer = async (offer: Offer) => {
    // The API refuses to delete an offer with pre-orders against it, and says
    // so. Asking here too means the common case — a draft typed in wrong —
    // does not need a round trip to find out it is fine.
    if (
      !window.confirm(
        `Delete this offer permanently?\n\n${offer.product_title ?? offer.id}\n\n` +
          `Offers with pre-orders against them cannot be deleted — unpublish those instead.`
      )
    ) {
      return
    }
    try {
      await fetchAdmin(`/admin/preorders/offers/${offer.id}`, { method: "DELETE" })
      toast.success("Offer deleted")
      reload()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not delete the offer")
    }
  }

  const editOffer = (offer: Offer) => {
    setEditingOffer(offer)
    setDrawerOpen(true)
  }

  const reconfirm = (offer: Offer) =>
    patchOffer(offer, { availability_verified: true }, "Availability re-confirmed")


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
          <Button size="small" onClick={() => {
                  setEditingOffer(null)
                  setDrawerOpen(true)
                }}>
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
            <Tabs.Trigger value="suppliers">Suppliers</Tabs.Trigger>
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
                          {o.product_title ? (
                            <Text size="small">
                              {o.product_title}
                              {o.variant_title && (
                                <span className="text-ui-fg-muted">
                                  {" "}· {o.variant_title}
                                </span>
                              )}
                            </Text>
                          ) : (
                            <Text size="small" className="text-ui-fg-error">
                              Listing deleted
                            </Text>
                          )}
                          <Text size="small" className="text-ui-fg-muted">
                            {label(o.condition)}
                            {!o.variant_id && o.product_title && " · all variants"}
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
                          {(() => {
                            const age = daysSince(o.availability_verified_at)
                            if (age === null) {
                              return (
                                <Text size="small" className="text-ui-fg-muted">
                                  Unverified
                                </Text>
                              )
                            }
                            const stale = age >= VERIFICATION_MAX_DAYS
                            const soon = age >= VERIFICATION_MAX_DAYS - 2
                            return (
                              <Text
                                size="small"
                                className={
                                  stale
                                    ? "text-ui-fg-error"
                                    : soon
                                      ? "text-ui-tag-orange-text"
                                      : "text-ui-fg-muted"
                                }
                              >
                                {stale
                                  ? `Stale — not sellable (${age}d)`
                                  : age === 0
                                    ? "Checked today"
                                    : `Checked ${age}d ago`}
                              </Text>
                            )
                          })()}
                          {o.offer_expires_at && (
                            <Text size="small" className="text-ui-fg-muted">
                              Expires{" "}
                              {new Date(o.offer_expires_at).toLocaleDateString()}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center gap-x-1">
                            <Button
                              size="small"
                              variant={o.is_active ? "secondary" : "primary"}
                              onClick={() => publish(o)}
                            >
                              {o.is_active ? "Unpublish" : "Verify & publish"}
                            </Button>

                            {/* Icons for the three that repeat on every row.
                                Publish stays worded because it is the
                                consequential one and its label changes with
                                state — an icon that means two opposite things
                                is a guess the operator has to make. */}
                            <IconButton
                              size="small"
                              variant="transparent"
                              onClick={() => editOffer(o)}
                              title="Edit offer"
                              aria-label="Edit offer"
                            >
                              <PencilSquare />
                            </IconButton>

                            {o.is_active && (
                              <IconButton
                                size="small"
                                variant="transparent"
                                onClick={() => reconfirm(o)}
                                title="Re-confirm availability"
                                aria-label="Re-confirm availability"
                              >
                                <ArrowPath />
                              </IconButton>
                            )}

                            {!o.is_active && (
                              <IconButton
                                size="small"
                                variant="transparent"
                                onClick={() => removeOffer(o)}
                                title="Delete offer"
                                aria-label="Delete offer"
                                className="text-ui-fg-error"
                              >
                                <Trash />
                              </IconButton>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            )}
          </Tabs.Content>
          <Tabs.Content value="suppliers" className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <Text size="small" className="text-ui-fg-subtle">
                Who you buy from. Recorded per offer so you can see whose
                items actually arrive inside the promised window.
              </Text>
              <Button size="small" variant="secondary" onClick={() => {
                  setEditingOffer(null)
                  setDrawerOpen(true)
                }}>
                Add via new offer
              </Button>
            </div>

            {suppliers.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                No suppliers yet. Add one while creating an offer — the
                &ldquo;+ New supplier&rdquo; link sits next to the supplier
                field.
              </Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Name</Table.HeaderCell>
                    <Table.HeaderCell>Country</Table.HeaderCell>
                    <Table.HeaderCell>Reference</Table.HeaderCell>
                    <Table.HeaderCell>Contact</Table.HeaderCell>
                    <Table.HeaderCell>Offers</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {suppliers.map((sup) => {
                    const count = (offers ?? []).filter(
                      (o) => o.supplier_id === sup.id
                    ).length
                    return (
                      <Table.Row key={sup.id}>
                        <Table.Cell>
                          <Text size="small">{sup.name}</Text>
                          {!sup.is_active && (
                            <Text size="small" className="text-ui-fg-muted">
                              inactive
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {(sup.country_code ?? "").toUpperCase()}
                        </Table.Cell>
                        <Table.Cell>{sup.reference ?? "—"}</Table.Cell>
                        <Table.Cell>{sup.contact_email ?? "—"}</Table.Cell>
                        <Table.Cell>{count}</Table.Cell>
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
        offer={editingOffer}
        suppliers={suppliers}
        onClose={() => {
          setDrawerOpen(false)
          setEditingOffer(null)
        }}
        onSaved={reload}
        onSuppliersChanged={reload}
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
