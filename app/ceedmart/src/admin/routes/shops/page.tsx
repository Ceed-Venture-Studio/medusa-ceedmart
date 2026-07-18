import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingsSolid } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// ─── Types ──────────────────────────────────────────────────────────────

type Shop = {
  id: string
  name: string
  code: string
  state: string | null
  city: string | null
  address: string | null
  phone: string | null
  stock_location_id: string | null
  sourcing_priority: string[]
  is_disabled: boolean
  created_at: string
  updated_at: string
}

type StockLocation = { id: string; name: string }

type ListResp = { shops: Shop[]; count: number }

type Editing =
  | { mode: "create" }
  | { mode: "edit"; shop: Shop }
  | null

// ─── Editor form ────────────────────────────────────────────────────────

type FormProps = {
  initial: Shop | null
  stockLocations: StockLocation[]
  onCancel: () => void
  onSaved: () => void
  onClose: () => void
}

const EditorForm = ({
  initial,
  stockLocations,
  onCancel,
  onSaved,
  onClose,
}: FormProps) => {
  const isEdit = initial !== null

  const [name, setName] = useState(initial?.name ?? "")
  const [code, setCode] = useState(initial?.code ?? "")
  const [state, setState] = useState(initial?.state ?? "")
  const [city, setCity] = useState(initial?.city ?? "")
  const [address, setAddress] = useState(initial?.address ?? "")
  const [phone, setPhone] = useState(initial?.phone ?? "")
  const [sourcing, setSourcing] = useState<string[]>(
    // On edit, exclude the shop's own location from the editable list —
    // it's always position 0 and the backend enforces that. On create,
    // there's no self yet, so the whole list is user-provided.
    initial
      ? initial.sourcing_priority.filter(
          (id) => id !== initial.stock_location_id
        )
      : []
  )
  const [saving, setSaving] = useState(false)

  // Stock locations available as sourcing fallbacks — exclude the current
  // shop's own location (it's implicit position 0).
  const selectableLocations = useMemo(
    () =>
      stockLocations.filter(
        (l) => !initial || l.id !== initial.stock_location_id
      ),
    [stockLocations, initial]
  )

  const locationName = (id: string) =>
    stockLocations.find((l) => l.id === id)?.name ?? id

  const addSourcing = (id: string) => {
    if (!id || sourcing.includes(id)) return
    setSourcing((s) => [...s, id])
  }
  const removeSourcing = (id: string) => {
    setSourcing((s) => s.filter((x) => x !== id))
  }
  const moveSourcing = (id: string, dir: -1 | 1) => {
    setSourcing((s) => {
      const idx = s.indexOf(id)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= s.length) return s
      const clone = [...s]
      const [item] = clone.splice(idx, 1)
      clone.splice(next, 0, item)
      return clone
    })
  }

  const handleSave = async () => {
    if (!name.trim() || !code.trim() || !state.trim()) {
      toast.error("Name, code, and state are required.")
      return
    }
    setSaving(true)
    try {
      const commonBody = {
        name: name.trim(),
        state: state.trim(),
        city: city.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        sourcing,
      }
      if (isEdit && initial) {
        await fetchAdmin(`/admin/shops/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonBody),
        })
        toast.success("Shop updated")
      } else {
        const created = await fetchAdmin<{ shop: any }>("/admin/shops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...commonBody, code: code.trim() }),
        })
        toast.success("Shop created")
        // Surface the publishable key immediately — it's the piece ops
        // needs to configure the POS device.
        window.prompt(
          "Save this publishable API key for the shop's POS device:",
          (created as any)?.shop?.publishable_api_key_token ?? ""
        )
      }
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Drawer.Header>
        <Drawer.Title>{isEdit ? "Edit shop" : "New shop"}</Drawer.Title>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Display name *</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Store 2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="code">Code *</Label>
          <Text size="small" className="text-ui-fg-subtle">
            Short slug — used in the publishable key title. Not editable after
            create.
          </Text>
          <Input
            id="code"
            value={code}
            disabled={isEdit}
            onChange={(e) => setCode(e.target.value)}
            placeholder="store-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="state">State *</Label>
          <Input
            id="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="rivers"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Port Harcourt"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="address">Address</Label>
          <Textarea
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            placeholder="Elelenwo, Port Harcourt"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+234…"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Sourcing priority (fallback locations)</Label>
          <Text size="small" className="text-ui-fg-subtle">
            When this shop is out of stock for an item, the platform tries
            these locations in order. The shop's own stock location is
            always tried first automatically.
          </Text>
          {sourcing.length === 0 && (
            <Text size="small" className="text-ui-fg-muted italic">
              No fallback locations set.
            </Text>
          )}
          <ul className="flex flex-col gap-2">
            {sourcing.map((id, idx) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-ui-border-base px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <Text weight="plus">{locationName(id)}</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {id}
                  </Text>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={idx === 0}
                    onClick={() => moveSourcing(id, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={idx === sourcing.length - 1}
                    onClick={() => moveSourcing(id, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => removeSourcing(id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Select
            value=""
            onValueChange={(v) => v && addSourcing(v)}
          >
            <Select.Trigger>
              <Select.Value placeholder="Add fallback location…" />
            </Select.Trigger>
            <Select.Content>
              {selectableLocations
                .filter((l) => !sourcing.includes(l.id))
                .map((l) => (
                  <Select.Item key={l.id} value={l.id}>
                    {l.name}
                  </Select.Item>
                ))}
            </Select.Content>
          </Select>
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} isLoading={saving}>
          {isEdit ? "Save changes" : "Create shop"}
        </Button>
      </Drawer.Footer>
    </>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────

const ShopsPage = () => {
  const [list, setList] = useState<ListResp | null>(null)
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editor, setEditor] = useState<Editing>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchAdmin<ListResp>("/admin/shops"),
      fetchAdmin<{ stock_locations: StockLocation[] }>(
        "/admin/shops/stock-locations"
      ),
    ])
      .then(([shops, locs]) => {
        if (cancelled) return
        setList(shops)
        setStockLocations(locs.stock_locations)
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
  }, [refreshTick])

  const handleDisable = async (s: Shop) => {
    if (!window.confirm(`Disable "${s.name}"? POS devices using its key will stop working.`)) return
    try {
      await fetchAdmin(`/admin/shops/${s.id}`, { method: "DELETE" })
      toast.success("Shop disabled")
      setRefreshTick((n) => n + 1)
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to disable")
    }
  }

  const handleReenable = async (s: Shop) => {
    try {
      await fetchAdmin(`/admin/shops/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_disabled: false }),
      })
      toast.success("Shop re-enabled")
      setRefreshTick((n) => n + 1)
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to re-enable")
    }
  }

  const locationName = (id: string) =>
    stockLocations.find((l) => l.id === id)?.name ?? id

  const rows = list?.shops ?? []

  const formKey =
    editor === null
      ? "closed"
      : editor.mode === "edit"
        ? `edit-${editor.shop.id}`
        : "new"
  const editorInitial = editor?.mode === "edit" ? editor.shop : null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Shops</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Each shop is a sales channel + stock location + publishable API
            key. The POS device is configured with the key alone; that's the
            switch that says "this device is Store N".
          </Text>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>New shop</Button>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Code</Table.HeaderCell>
              <Table.HeaderCell>State / City</Table.HeaderCell>
              <Table.HeaderCell>Sourcing fallback</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && !loading ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    No shops yet. Create the first one with "New shop".
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              rows.map((s) => {
                // Sourcing preview: everything after self.
                const fallbacks = s.sourcing_priority.filter(
                  (id) => id !== s.stock_location_id
                )
                return (
                  <Table.Row key={s.id}>
                    <Table.Cell>
                      <Text weight="plus">{s.name}</Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        {s.id}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">{s.code || "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">{s.state || "—"}</Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        {s.city || "—"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {fallbacks.length === 0 ? (
                        <Text size="small" className="text-ui-fg-subtle italic">
                          self only
                        </Text>
                      ) : (
                        <Text size="small">
                          {fallbacks.map(locationName).join(" → ")}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={s.is_disabled ? "grey" : "green"}>
                        {s.is_disabled ? "disabled" : "active"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => setEditor({ mode: "edit", shop: s })}
                        >
                          Edit
                        </Button>
                        {s.is_disabled ? (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => handleReenable(s)}
                          >
                            Enable
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => handleDisable(s)}
                          >
                            Disable
                          </Button>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table>
      </div>

      <Drawer
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <Drawer.Content>
          {editor !== null && (
            <EditorForm
              key={formKey}
              initial={editorInitial}
              stockLocations={stockLocations}
              onCancel={() => setEditor(null)}
              onClose={() => setEditor(null)}
              onSaved={() => setRefreshTick((n) => n + 1)}
            />
          )}
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Shops",
  icon: BuildingsSolid,
})

export default ShopsPage
