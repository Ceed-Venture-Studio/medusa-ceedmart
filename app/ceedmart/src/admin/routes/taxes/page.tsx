import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// ─── Types ──────────────────────────────────────────────────────────────

type Scope = "general" | "collection" | "shop"

type TaxOverride = {
  id: string
  name: string
  rate: number
  is_tax_inclusive: boolean
  scope: Scope
  reference_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type ListResp = { tax_overrides: TaxOverride[]; count: number }

type Collection = { id: string; title: string; handle: string }
type Shop = {
  id: string
  name: string
  code: string
  is_disabled: boolean
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; rule: TaxOverride }
  | null

// ─── Editor form ────────────────────────────────────────────────────────

type FormProps = {
  initial: TaxOverride | null
  collections: Collection[]
  shops: Shop[]
  onCancel: () => void
  onSaved: () => void
  onClose: () => void
}

const EditorForm = ({
  initial,
  collections,
  shops,
  onCancel,
  onSaved,
  onClose,
}: FormProps) => {
  const isEdit = initial !== null

  const [name, setName] = useState(initial?.name ?? "")
  const [rate, setRate] = useState<string>(
    initial ? String(initial.rate) : "7.5"
  )
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "general")
  const [referenceId, setReferenceId] = useState(initial?.reference_id ?? "")
  const [isInclusive, setIsInclusive] = useState(
    initial?.is_tax_inclusive ?? false
  )
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [saving, setSaving] = useState(false)

  const handleScopeChange = (v: Scope) => {
    setScope(v)
    // Reset reference when scope kind changes.
    setReferenceId("")
  }

  const handleSave = async () => {
    const rateNum = Number(rate)
    if (!name.trim()) {
      toast.error("Name is required.")
      return
    }
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
      toast.error("Rate must be between 0 and 100.")
      return
    }
    if (scope !== "general" && !referenceId) {
      toast.error(
        scope === "collection"
          ? "Pick a product collection."
          : "Pick a shop."
      )
      return
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        rate: rateNum,
        is_tax_inclusive: isInclusive,
        scope,
        reference_id: scope === "general" ? null : referenceId,
        is_active: isActive,
      }
      if (isEdit && initial) {
        await fetchAdmin(`/admin/taxes/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        toast.success("Tax rule updated")
      } else {
        await fetchAdmin("/admin/taxes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        toast.success("Tax rule created")
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
        <Drawer.Title>
          {isEdit ? "Edit tax rule" : "New tax rule"}
        </Drawer.Title>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nigeria VAT"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="rate">Rate (%) *</Label>
          <Input
            id="rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="7.5"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Scope *</Label>
          <Text size="small" className="text-ui-fg-subtle">
            General applies to everything unless a shop or collection rule
            wins. Shop rules take priority over collection rules.
          </Text>
          <Select value={scope} onValueChange={(v) => handleScopeChange(v as Scope)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="general">General (all products)</Select.Item>
              <Select.Item value="collection">Product collection</Select.Item>
              <Select.Item value="shop">Shop</Select.Item>
            </Select.Content>
          </Select>
        </div>

        {scope === "collection" && (
          <div className="flex flex-col gap-1">
            <Label>Collection *</Label>
            <Select value={referenceId} onValueChange={setReferenceId}>
              <Select.Trigger>
                <Select.Value placeholder="Select a collection…" />
              </Select.Trigger>
              <Select.Content>
                {collections.map((c) => (
                  <Select.Item key={c.id} value={c.id}>
                    {c.title}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        )}

        {scope === "shop" && (
          <div className="flex flex-col gap-1">
            <Label>Shop *</Label>
            <Select value={referenceId} onValueChange={setReferenceId}>
              <Select.Trigger>
                <Select.Value placeholder="Select a shop…" />
              </Select.Trigger>
              <Select.Content>
                {shops
                  .filter((s) => !s.is_disabled)
                  .map((s) => (
                    <Select.Item key={s.id} value={s.id}>
                      {s.name}
                    </Select.Item>
                  ))}
              </Select.Content>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between rounded-md border border-ui-border-base p-3">
          <div>
            <Text weight="plus">Included in item price</Text>
            <Text size="small" className="text-ui-fg-subtle">
              On: item price already includes this tax. Off: tax is added at
              subtotal.
            </Text>
          </div>
          <Switch checked={isInclusive} onCheckedChange={setIsInclusive} />
        </div>

        <div className="flex items-center justify-between rounded-md border border-ui-border-base p-3">
          <div>
            <Text weight="plus">Active</Text>
            <Text size="small" className="text-ui-fg-subtle">
              Inactive rules never apply.
            </Text>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} isLoading={saving}>
          {isEdit ? "Save changes" : "Create rule"}
        </Button>
      </Drawer.Footer>
    </>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────

const TaxesPage = () => {
  const [list, setList] = useState<ListResp | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editor, setEditor] = useState<Editing>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchAdmin<ListResp>("/admin/taxes"),
      fetchAdmin<{ collections: Collection[] }>("/admin/taxes/collections"),
      fetchAdmin<{ shops: Shop[] }>("/admin/shops"),
    ])
      .then(([rules, colls, shopsResp]) => {
        if (cancelled) return
        setList(rules)
        setCollections(colls.collections)
        setShops(shopsResp.shops)
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

  const collectionsById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of collections) map.set(c.id, c.title)
    return map
  }, [collections])
  const shopsById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of shops) map.set(s.id, s.name)
    return map
  }, [shops])

  const scopeLabel = (rule: TaxOverride): string => {
    if (rule.scope === "general") return "All products"
    if (rule.scope === "collection") {
      return `Collection: ${
        (rule.reference_id && collectionsById.get(rule.reference_id)) ||
        rule.reference_id ||
        "—"
      }`
    }
    if (rule.scope === "shop") {
      return `Shop: ${
        (rule.reference_id && shopsById.get(rule.reference_id)) ||
        rule.reference_id ||
        "—"
      }`
    }
    return rule.scope
  }

  const handleDelete = async (rule: TaxOverride) => {
    if (!window.confirm(`Delete "${rule.name}"? This can't be undone.`)) return
    try {
      await fetchAdmin(`/admin/taxes/${rule.id}`, { method: "DELETE" })
      toast.success("Tax rule deleted")
      setRefreshTick((n) => n + 1)
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete")
    }
  }

  const rows = list?.tax_overrides ?? []

  const formKey =
    editor === null
      ? "closed"
      : editor.mode === "edit"
        ? `edit-${editor.rule.id}`
        : "new"
  const editorInitial = editor?.mode === "edit" ? editor.rule : null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Taxes</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Rules the Ceedmart tax provider evaluates on every cart / order.
            Priority: shop &gt; collection &gt; general.
          </Text>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>New rule</Button>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Scope</Table.HeaderCell>
              <Table.HeaderCell>Rate</Table.HeaderCell>
              <Table.HeaderCell>Inclusive?</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && !loading ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    No tax rules yet. Start with a General rule at 7.5% for
                    Nigeria VAT.
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    <Text weight="plus">{r.name}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{scopeLabel(r)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text weight="plus">{Number(r.rate)}%</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {r.is_tax_inclusive
                        ? "In item price"
                        : "Added at subtotal"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={r.is_active ? "green" : "grey"}>
                      {r.is_active ? "active" : "inactive"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex gap-2">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() =>
                          setEditor({ mode: "edit", rule: r })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => handleDelete(r)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
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
              collections={collections}
              shops={shops}
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
  label: "Taxes",
  icon: CurrencyDollar,
})

export default TaxesPage
