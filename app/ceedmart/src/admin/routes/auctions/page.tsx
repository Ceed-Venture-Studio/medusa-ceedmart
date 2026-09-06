import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Clock } from "@medusajs/icons"
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
import { useCallback, useEffect, useState } from "react"
import { fetchAdmin } from "../../lib/client"
import ProductPicker, {
  type ProductSelection,
} from "../../components/product-picker"

// Auction operations (BRD §8.4, §8.6, §8.10).
//
// Publishing is a deliberate, validated step — an auction goes live because
// someone checked it, not because they filled in a form. The API refuses to
// publish one missing an item or a condition report, and this surfaces that
// refusal verbatim rather than paraphrasing it.

type AuctionRow = {
  id: string
  reference: string
  title: string
  status: string
  condition: string
  starts_at: string
  ends_at: string
  starting_price: number
  current_price: number | null
  reserve_price: number | null
  bid_count: number
  extension_count: number
  condition_report: string | null
  inventory_item_id: string | null
  variant_id: string | null
  result: {
    winner_id: string | null
    winning_amount: number | null
    reserve_met: boolean
    unique_bidders: number
  } | null
}

type BidRow = {
  id: string
  sequence: number
  bidder_id: string
  bidder_handle: string
  amount: number
  placed_at: string
  kind: string
  voided_at: string | null
  void_reason: string | null
  triggered_extension: boolean
}

const naira = (kobo: number | null | undefined) =>
  kobo == null ? "—" : `₦${(Number(kobo) / 100).toLocaleString()}`

const label = (v: string) =>
  v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey"> = {
  draft: "grey",
  scheduled: "orange",
  live: "green",
  ended: "grey",
  awaiting_winner_payment: "orange",
  winner_defaulted: "red",
  offered_to_next_bidder: "orange",
  reserve_not_met: "grey",
  disputed: "red",
  cancelled: "red",
  completed: "green",
}

// ─── Create drawer ────────────────────────────────────────────────────────

const CreateDrawer = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) => {
  const [listing, setListing] = useState<ProductSelection>({
    productId: null,
    variantId: null,
    label: "",
  })
  const [form, setForm] = useState<Record<string, string>>({
    title: "",
    description: "",
    inventory_item_id: "",
    unit_reference: "",
    condition: "used",
    condition_report: "",
    starts_at: "",
    ends_at: "",
    starting_price: "",
    min_increment: "",
    reserve_price: "",
    buy_now_price: "",
    deposit_amount: "",
    payment_window_hours: "24",
    antisnipe_window_seconds: "300",
    antisnipe_extension_seconds: "300",
  })
  const [busy, setBusy] = useState(false)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const kobo = (k: string) => {
    const n = Number(form[k])
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined
  }

  const save = async () => {
    if (!form.title.trim() || !form.starts_at || !form.ends_at) {
      toast.error("Title, start and end time are required")
      return
    }
    if (!kobo("min_increment")) {
      toast.error("A bid increment is required")
      return
    }

    setBusy(true)
    try {
      await fetchAdmin("/admin/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          variant_id: listing.variantId ?? undefined,
          inventory_item_id: form.inventory_item_id.trim() || undefined,
          unit_reference: form.unit_reference.trim() || undefined,
          condition: form.condition,
          condition_report: form.condition_report.trim() || undefined,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: new Date(form.ends_at).toISOString(),
          starting_price: kobo("starting_price") ?? 0,
          min_increment: kobo("min_increment"),
          reserve_price: kobo("reserve_price"),
          buy_now_price: kobo("buy_now_price"),
          deposit_amount: kobo("deposit_amount"),
          payment_window_hours: Number(form.payment_window_hours) || 24,
          antisnipe_window_seconds: Number(form.antisnipe_window_seconds) || 300,
          antisnipe_extension_seconds:
            Number(form.antisnipe_extension_seconds) || 300,
        }),
      })
      toast.success("Auction created as a draft — review it, then publish")
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create the auction")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New auction</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <Label size="small">Title</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Description</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <ProductPicker
            value={listing}
            onChange={(sel) => {
              setListing(sel)
              // An auction sells one unit, so the title defaults to the
              // listing — the operator can still override it for a lot
              // description like "ThinkPad X1, ex-demo".
              if (sel.label && !form.title.trim()) set("title", sel.label)
            }}
            requireVariant
            helpText="An auction sells one specific unit of a listing you already carry."
          />

          <div className="flex flex-col gap-1">
            <Text size="small" className="text-ui-fg-muted">
              Inventory item ID (optional)
            </Text>
            <Input
              value={form.inventory_item_id}
              onChange={(e) => set("inventory_item_id", e.target.value)}
              placeholder="Locks this exact unit against other checkouts"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Serial / unit reference</Label>
            <Input
              value={form.unit_reference}
              onChange={(e) => set("unit_reference", e.target.value)}
            />
            <Text size="small" className="text-ui-fg-muted">
              This sells one specific unit, not "one of these".
            </Text>
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Condition</Label>
            <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {["new", "open_box", "refurbished", "used", "for_parts"].map((c) => (
                  <Select.Item key={c} value={c}>{label(c)}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label size="small">Condition report</Label>
            <Textarea
              rows={3}
              value={form.condition_report}
              onChange={(e) => set("condition_report", e.target.value)}
              placeholder="Scratches on the lid, battery at 87% health, no charger included."
            />
            <Text size="small" className="text-ui-fg-muted">
              Required to publish. Be specific — a bidder who felt misled about
              condition becomes a dispute.
            </Text>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Opens</Text>
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Closes</Text>
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              ["starting_price", "Starting price (₦)"],
              ["min_increment", "Bid increment (₦)"],
              ["reserve_price", "Reserve (₦, hidden)"],
              ["buy_now_price", "Buy Now (₦, optional)"],
              ["deposit_amount", "Bidder deposit (₦, optional)"],
              ["payment_window_hours", "Payment window (hours)"],
            ].map(([k, name]) => (
              <div key={k} className="flex flex-col gap-1">
                <Text size="small" className="text-ui-fg-muted">{name}</Text>
                <Input value={form[k]} onChange={(e) => set(k, e.target.value)} inputMode="numeric" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-ui-border-base pt-3">
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Anti-snipe window (s)</Text>
              <Input
                value={form.antisnipe_window_seconds}
                onChange={(e) => set("antisnipe_window_seconds", e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Extension (s)</Text>
              <Input
                value={form.antisnipe_extension_seconds}
                onChange={(e) => set("antisnipe_extension_seconds", e.target.value)}
                inputMode="numeric"
              />
            </div>
            <Text size="small" className="text-ui-fg-muted col-span-2">
              A bid inside the window pushes the close out by the extension,
              measured from the bid — so a last-second bid gives everyone the
              full window back.
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} isLoading={busy}>Create draft</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────

const DetailDrawer = ({
  auction,
  onClose,
  onChanged,
}: {
  auction: AuctionRow | null
  onClose: () => void
  onChanged: () => void
}) => {
  const [bids, setBids] = useState<BidRow[] | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!auction) return
    fetchAdmin<{ bids: BidRow[] }>(`/admin/auctions/${auction.id}`)
      .then((r) => setBids(r.bids))
      .catch(() => setBids([]))
  }, [auction?.id])

  useEffect(() => {
    setBids(null)
    setReason("")
    load()
  }, [auction?.id, load])

  if (!auction) return null

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      await fetchAdmin(`/admin/auctions/${auction.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim() || undefined, ...extra }),
      })
      toast.success(`Auction ${action}`)
      onChanged()
      onClose()
    } catch (err: any) {
      // The API names exactly what is missing; show it verbatim.
      toast.error(err?.message ?? "That didn't work")
    } finally {
      setBusy(false)
    }
  }

  const voidBid = async (bid: BidRow) => {
    if (!reason.trim()) {
      toast.error("Enter a reason above before voiding a bid — it's permanent")
      return
    }
    try {
      await fetchAdmin(`/admin/auctions/${auction.id}/bids/${bid.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      toast.success(`Bid #${bid.sequence} voided`)
      load()
      onChanged()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not void that bid")
    }
  }

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{auction.title}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <Badge>{auction.reference}</Badge>
            <StatusBadge color={STATUS_COLOR[auction.status] ?? "grey"}>
              {label(auction.status)}
            </StatusBadge>
            {auction.extension_count > 0 && (
              <StatusBadge color="orange">
                Extended ×{auction.extension_count}
              </StatusBadge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              ["Current", naira(auction.current_price ?? auction.starting_price)],
              ["Reserve", naira(auction.reserve_price)],
              ["Bids", String(auction.bid_count)],
              ["Closes", when(auction.ends_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <Text size="small" className="text-ui-fg-muted">{k}</Text>
                <Text size="small">{v}</Text>
              </div>
            ))}
          </div>

          {auction.result && (
            <div className="rounded-md bg-ui-bg-subtle p-3">
              <Text size="small" weight="plus">Outcome</Text>
              <Text size="small" className="text-ui-fg-subtle">
                {auction.result.winner_id
                  ? `Won at ${naira(auction.result.winning_amount)} · ${auction.result.unique_bidders} unique bidder(s)`
                  : "Reserve not met — no sale"}
              </Text>
            </div>
          )}

          <div className="flex flex-col gap-1 border-t border-ui-border-base pt-4">
            <Label size="small">Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required to cancel or void — bidders are told"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {auction.status === "draft" && (
              <Button onClick={() => act("publish")} isLoading={busy}>
                Publish
              </Button>
            )}
            {auction.status === "winner_defaulted" && (
              <Button variant="secondary" onClick={() => act("offer_next")} isLoading={busy}>
                Offer to next bidder
              </Button>
            )}
            {!["cancelled", "completed"].includes(auction.status) && (
              <Button variant="danger" onClick={() => act("cancel")} isLoading={busy}>
                Cancel auction
              </Button>
            )}
          </div>

          <div className="border-t border-ui-border-base pt-4">
            <Text size="small" weight="plus" className="mb-2">
              Bid ledger
            </Text>
            {!bids ? (
              <Text size="small" className="text-ui-fg-muted">Loading…</Text>
            ) : bids.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">No bids yet.</Text>
            ) : (
              <div className="flex flex-col gap-1">
                {bids.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-2 border-b border-ui-border-base pb-1"
                  >
                    <div className="flex flex-col">
                      <Text size="small" className={b.voided_at ? "line-through" : ""}>
                        #{b.sequence} · {naira(b.amount)}
                        {b.kind === "buy_now" ? " (Buy Now)" : ""}
                        {b.triggered_extension ? " · extended" : ""}
                      </Text>
                      <Text size="small" className="text-ui-fg-muted">
                        {b.bidder_handle} · {when(b.placed_at)}
                        {b.void_reason ? ` · voided: ${b.void_reason}` : ""}
                      </Text>
                    </div>
                    {!b.voided_at && !auction.result && (
                      <Button size="small" variant="transparent" onClick={() => voidBid(b)}>
                        Void
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Text size="small" className="text-ui-fg-muted mt-2">
              Bids are never deleted. Voiding keeps the row and its sequence,
              with your reason attached.
            </Text>
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const AuctionsPage = () => {
  const [auctions, setAuctions] = useState<AuctionRow[] | null>(null)
  const [open, setOpen] = useState<AuctionRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchAdmin<{ auctions: AuctionRow[] }>("/admin/auctions")
      .then((r) => !cancelled && setAuctions(r.auctions))
      .catch((err) => !cancelled && setError(err?.message ?? "Could not load"))
    return () => {
      cancelled = true
    }
  }, [tick])

  const group = (predicate: (a: AuctionRow) => boolean) =>
    (auctions ?? []).filter(predicate)

  const needsAttention = group((a) =>
    ["winner_defaulted", "disputed", "awaiting_winner_payment"].includes(a.status)
  )

  const renderTable = (rows: AuctionRow[]) =>
    rows.length === 0 ? (
      <Text size="small" className="text-ui-fg-muted">Nothing here.</Text>
    ) : (
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Lot</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Price</Table.HeaderCell>
            <Table.HeaderCell>Bids</Table.HeaderCell>
            <Table.HeaderCell>Closes</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((a) => (
            <Table.Row key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
              <Table.Cell>
                <Text size="small">{a.title}</Text>
                <Text size="small" className="text-ui-fg-muted font-mono">
                  {a.reference}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <StatusBadge color={STATUS_COLOR[a.status] ?? "grey"}>
                  {label(a.status)}
                </StatusBadge>
              </Table.Cell>
              <Table.Cell>
                <Text size="small">{naira(a.current_price ?? a.starting_price)}</Text>
                {a.reserve_price !== null && (
                  <Text size="small" className="text-ui-fg-muted">
                    reserve {naira(a.reserve_price)}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>{a.bid_count}</Table.Cell>
              <Table.Cell>{when(a.ends_at)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Auctions</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {needsAttention.length > 0
              ? `${needsAttention.length} need attention`
              : "Nothing needs attention"}
          </Text>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={reload}>Refresh</Button>
          <Button size="small" onClick={() => setCreating(true)}>New auction</Button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      <div className="px-6 py-4">
        {!auctions ? (
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        ) : (
          <Tabs defaultValue="attention">
            <Tabs.List>
              <Tabs.Trigger value="attention">Needs attention</Tabs.Trigger>
              <Tabs.Trigger value="live">Live</Tabs.Trigger>
              <Tabs.Trigger value="drafts">Drafts</Tabs.Trigger>
              <Tabs.Trigger value="all">All</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="attention" className="pt-4">
              {renderTable(needsAttention)}
            </Tabs.Content>
            <Tabs.Content value="live" className="pt-4">
              {renderTable(group((a) => ["live", "scheduled"].includes(a.status)))}
            </Tabs.Content>
            <Tabs.Content value="drafts" className="pt-4">
              {renderTable(group((a) => a.status === "draft"))}
            </Tabs.Content>
            <Tabs.Content value="all" className="pt-4">
              {renderTable(auctions)}
            </Tabs.Content>
          </Tabs>
        )}
      </div>

      <CreateDrawer open={creating} onClose={() => setCreating(false)} onSaved={reload} />
      <DetailDrawer auction={open} onClose={() => setOpen(null)} onChanged={reload} />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Auctions",
  icon: Clock,
})

export default AuctionsPage
