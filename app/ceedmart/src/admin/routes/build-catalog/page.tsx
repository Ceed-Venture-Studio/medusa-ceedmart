import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Microchip } from "@medusajs/icons"
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
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { backendUrl, fetchAdmin } from "../../lib/client"

// The component catalogue (BRD §7.3, §7.4, §7.1).
//
// Parts are entered here — by hand for a few, by sheet for many. Both go
// through the same validation, so a hand-typed part and an imported one end
// up identical; if they didn't, the compatibility engine would see two
// shapes of the same thing.
//
// Nothing on this screen knows what a PC is. Slots, their fields and their
// build types are all data, so a future kind of configurable product — a
// CCTV kit, a solar system — is a BuildType row plus categories carrying
// their own schemas, with no change here.

type Field = {
  key: string
  label: string
  type: "text" | "number" | "boolean" | "enum" | "list"
  unit?: string
  required?: boolean
  options?: string[]
  help?: string
  usedByRules?: boolean
}

type Category = {
  id: string
  code: string
  label: string
  build_types: string[]
  is_required: boolean
  allows_multiple: boolean
  max_quantity: number
  help_text: string | null
  attribute_schema: Field[]
  option_count: number
}

type BuildType = { id: string; code: string; label: string }

type Option = {
  id: string
  label: string
  brand: string | null
  variant_id: string | null
  indicative_price: number | null
  is_fixed: boolean
  model_family: string | null
  attributes: Record<string, unknown>
  is_active: boolean
}

type ImportRow = {
  row: number
  label: string
  action: "create" | "update" | "skip"
  errors: string[]
  warnings: string[]
}

type ImportResult = {
  applied: boolean
  summary: {
    total: number
    create: number
    update: number
    skipped: number
    with_warnings: number
  }
  ignored_columns: string[]
  results: ImportRow[]
}

const naira = (kobo: number | null | undefined) =>
  kobo == null ? "—" : `₦${(Number(kobo) / 100).toLocaleString()}`

const showAttr = (v: unknown): string =>
  Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : String(v ?? "—")

// ─── Add a part ───────────────────────────────────────────────────────────

const OptionDrawer = ({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null
  onClose: () => void
  onSaved: () => void
}) => {
  const [form, setForm] = useState<Record<string, string>>({})
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({})
    setAttrs({})
  }, [category?.id])

  if (!category) return null

  const save = async () => {
    if (!form.label?.trim()) {
      toast.error("Give the part a name")
      return
    }
    setBusy(true)
    try {
      const res = await fetchAdmin<{ warnings: { message: string }[] }>(
        `/admin/build-catalog/categories/${category.id}/options`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.label.trim(),
            brand: form.brand?.trim() || undefined,
            variant_id: form.variant_id?.trim() || undefined,
            indicative_price: form.price
              ? Math.round(Number(form.price) * 100)
              : undefined,
            is_fixed: form.is_fixed === "yes",
            model_family: form.model_family?.trim() || undefined,
            attributes: attrs,
          }),
        }
      )
      toast.success(`${form.label.trim()} added`)
      // Warnings are shown rather than swallowed — the part saved, but a
      // missing rule-critical field means the engine skips that check.
      res.warnings?.forEach((w) => toast.warning(w.message))
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save that part")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Add a {category.label.toLowerCase()}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <Label size="small">Name</Label>
            <Input
              value={form.label ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="AMD Ryzen 7 7700X"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Brand</Text>
              <Input
                value={form.brand ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Text size="small" className="text-ui-fg-muted">Indicative price (₦)</Text>
              <Input
                value={form.price ?? ""}
                inputMode="numeric"
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-ui-border-base px-3 py-2">
            <div className="flex flex-col">
              <Text size="small">Fixed on this model</Text>
              <Text size="small" className="text-ui-fg-muted">
                Soldered or otherwise unchangeable — shown without a choice.
              </Text>
            </div>
            <Switch
              checked={form.is_fixed === "yes"}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, is_fixed: v ? "yes" : "no" }))
              }
            />
          </div>

          <div className="border-t border-ui-border-base pt-3">
            <Text size="small" weight="plus">Specifications</Text>
            <Text size="small" className="text-ui-fg-muted mb-3">
              Fields marked ⚙ are read by the compatibility rules. Leave one
              blank and that check is skipped for this part.
            </Text>

            <div className="flex flex-col gap-3">
              {category.attribute_schema.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <Text size="small" className="text-ui-fg-muted">
                    {field.label}
                    {field.unit ? ` (${field.unit})` : ""}
                    {field.required && <span className="text-ui-fg-error"> *</span>}
                    {field.usedByRules && <span title="Used by compatibility rules"> ⚙</span>}
                  </Text>

                  {field.type === "enum" ? (
                    <Select
                      value={attrs[field.key] ?? ""}
                      onValueChange={(v) => setAttrs((a) => ({ ...a, [field.key]: v }))}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Choose" />
                      </Select.Trigger>
                      <Select.Content>
                        {(field.options ?? []).map((o) => (
                          <Select.Item key={o} value={o}>{o}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  ) : field.type === "boolean" ? (
                    <Select
                      value={attrs[field.key] ?? ""}
                      onValueChange={(v) => setAttrs((a) => ({ ...a, [field.key]: v }))}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="—" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="yes">Yes</Select.Item>
                        <Select.Item value="no">No</Select.Item>
                      </Select.Content>
                    </Select>
                  ) : (
                    <Input
                      value={attrs[field.key] ?? ""}
                      inputMode={field.type === "number" ? "numeric" : undefined}
                      placeholder={field.type === "list" ? "Comma separated" : undefined}
                      onChange={(e) =>
                        setAttrs((a) => ({ ...a, [field.key]: e.target.value }))
                      }
                    />
                  )}

                  {field.help && (
                    <Text size="small" className="text-ui-fg-muted">{field.help}</Text>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} isLoading={busy}>Add part</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Bulk upload ──────────────────────────────────────────────────────────

const ImportDrawer = ({
  category,
  onClose,
  onImported,
}: {
  category: Category | null
  onClose: () => void
  onImported: () => void
}) => {
  const [csv, setCsv] = useState("")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCsv("")
    setResult(null)
  }, [category?.id])

  if (!category) return null

  const run = async (apply: boolean) => {
    if (!csv.trim()) {
      toast.error("Choose a file first")
      return
    }
    setBusy(true)
    try {
      const res = await fetchAdmin<ImportResult>(
        `/admin/build-catalog/categories/${category.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv, apply }),
        }
      )
      setResult(res)
      if (apply) {
        toast.success(
          `${res.summary.create} added, ${res.summary.update} updated` +
            (res.summary.skipped ? `, ${res.summary.skipped} skipped` : "")
        )
        onImported()
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Could not read that file")
    } finally {
      setBusy(false)
    }
  }

  const failing = result?.results.filter((r) => r.errors.length) ?? []

  return (
    <Drawer open onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Bulk upload · {category.label}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2 rounded-md bg-ui-bg-subtle p-3">
            <Text size="small">
              Start from the template — it carries this slot&apos;s exact
              columns, so it can never disagree with what the importer
              accepts.
            </Text>
            <a
              href={backendUrl(
                `/admin/build-catalog/categories/${category.id}/template`
              )}
              className="txt-small text-ui-fg-interactive underline w-fit"
            >
              Download {category.code} template
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <Label size="small">CSV file</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="txt-small"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setCsv(await file.text())
                setResult(null)
              }}
            />
            <Text size="small" className="text-ui-fg-muted">
              Or paste the rows below.
            </Text>
            <Textarea
              rows={4}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value)
                setResult(null)
              }}
              placeholder="label,brand,..."
            />
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => run(false)} isLoading={busy}>
              Check the file
            </Button>
            <Button
              onClick={() => run(true)}
              isLoading={busy}
              disabled={!result || failing.length === result.results.length}
            >
              Import
            </Button>
          </div>

          {result && (
            <div className="flex flex-col gap-3 border-t border-ui-border-base pt-3">
              <div className="flex flex-wrap gap-2">
                <Badge>{result.summary.total} rows</Badge>
                <StatusBadge color="green">{result.summary.create} new</StatusBadge>
                <StatusBadge color="blue">{result.summary.update} updates</StatusBadge>
                {result.summary.skipped > 0 && (
                  <StatusBadge color="red">{result.summary.skipped} skipped</StatusBadge>
                )}
                {!result.applied && <Badge>Nothing written yet</Badge>}
              </div>

              {result.ignored_columns.length > 0 && (
                <Text size="small" className="text-ui-fg-muted">
                  Ignored columns: {result.ignored_columns.join(", ")}
                </Text>
              )}

              {failing.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Text size="small" weight="plus" className="text-ui-fg-error">
                    {failing.length} row{failing.length === 1 ? "" : "s"} will be
                    skipped
                  </Text>
                  {failing.slice(0, 12).map((r) => (
                    <Text key={r.row} size="small" className="text-ui-fg-subtle">
                      Line {r.row} · {r.label || "(no name)"} — {r.errors.join("; ")}
                    </Text>
                  ))}
                  <Text size="small" className="text-ui-fg-muted">
                    The rest of the file still imports. Fix these and upload
                    again — matching is by name, so corrected rows update
                    rather than duplicate.
                  </Text>
                </div>
              )}

              {result.summary.with_warnings > 0 && (
                <Text size="small" className="text-ui-fg-muted">
                  {result.summary.with_warnings} row
                  {result.summary.with_warnings === 1 ? "" : "s"} missing a
                  spec the compatibility rules read — those checks will be
                  skipped for them.
                </Text>
              )}
            </div>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const BuildCatalogPage = () => {
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [buildTypes, setBuildTypes] = useState<BuildType[]>([])
  const [openCategory, setOpenCategory] = useState<Category | null>(null)
  const [options, setOptions] = useState<Option[] | null>(null)
  const [adding, setAdding] = useState<Category | null>(null)
  const [importing, setImporting] = useState<Category | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchAdmin<{ categories: Category[]; build_types: BuildType[] }>(
      "/admin/build-catalog/categories"
    )
      .then((r) => {
        if (cancelled) return
        setCategories(r.categories)
        setBuildTypes(r.build_types ?? [])
      })
      .catch((err) => !cancelled && setError(err?.message ?? "Could not load"))
    return () => {
      cancelled = true
    }
  }, [tick])

  // Load a slot's parts when it is opened.
  useEffect(() => {
    if (!openCategory) {
      setOptions(null)
      return
    }
    fetchAdmin<{ options: Option[] }>(
      `/admin/build-catalog/categories/${openCategory.id}/options`
    )
      .then((r) => setOptions(r.options))
      .catch(() => setOptions([]))
  }, [openCategory?.id, tick])

  const grouped = useMemo(() => {
    const out = new Map<string, Category[]>()
    for (const c of categories ?? []) {
      for (const t of c.build_types ?? []) {
        out.set(t, [...(out.get(t) ?? []), c])
      }
    }
    return out
  }, [categories])

  const emptyRequired = (categories ?? []).filter(
    (c) => c.is_required && c.option_count === 0
  )

  const renderSlots = (rows: Category[]) => (
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>Slot</Table.HeaderCell>
          <Table.HeaderCell>Parts</Table.HeaderCell>
          <Table.HeaderCell>Specs tracked</Table.HeaderCell>
          <Table.HeaderCell>&nbsp;</Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((c) => (
          <Table.Row key={c.id}>
            <Table.Cell>
              <Text size="small">
                {c.label}
                {c.is_required && <span className="text-ui-fg-error"> *</span>}
              </Text>
              <Text size="small" className="text-ui-fg-muted">
                {c.allows_multiple ? `up to ${c.max_quantity}` : "one"}
              </Text>
            </Table.Cell>
            <Table.Cell>
              {c.option_count === 0 && c.is_required ? (
                <StatusBadge color="red">none</StatusBadge>
              ) : (
                <Text size="small">{c.option_count}</Text>
              )}
            </Table.Cell>
            <Table.Cell>
              <Text size="small" className="text-ui-fg-muted">
                {c.attribute_schema.length} fields ·{" "}
                {c.attribute_schema.filter((f) => f.usedByRules).length} used by rules
              </Text>
            </Table.Cell>
            <Table.Cell>
              <div className="flex gap-1">
                <Button size="small" variant="secondary" onClick={() => setOpenCategory(c)}>
                  Open
                </Button>
                <Button size="small" onClick={() => setAdding(c)}>Add</Button>
                <Button size="small" variant="transparent" onClick={() => setImporting(c)}>
                  Upload
                </Button>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Build Catalogue</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {emptyRequired.length > 0
              ? `${emptyRequired.length} required slot${emptyRequired.length === 1 ? "" : "s"} have no parts — the builder stays hidden until they do`
              : "Every required slot has parts"}
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={reload}>Refresh</Button>
      </div>

      {error && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      <div className="px-6 py-4">
        {!categories ? (
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        ) : buildTypes.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No build types configured. Run the catalogue seed to create
            desktop and laptop.
          </Text>
        ) : (
          <Tabs defaultValue={buildTypes[0]?.code}>
            <Tabs.List>
              {buildTypes.map((t) => (
                <Tabs.Trigger key={t.code} value={t.code}>{t.label}</Tabs.Trigger>
              ))}
            </Tabs.List>
            {buildTypes.map((t) => (
              <Tabs.Content key={t.code} value={t.code} className="pt-4">
                {renderSlots(grouped.get(t.code) ?? [])}
              </Tabs.Content>
            ))}
          </Tabs>
        )}
      </div>

      {/* Parts in the opened slot */}
      {openCategory && (
        <Drawer open onOpenChange={(v) => !v && setOpenCategory(null)}>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title>{openCategory.label}</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-3 overflow-y-auto">
              {openCategory.help_text && (
                <Text size="small" className="text-ui-fg-muted">
                  {openCategory.help_text}
                </Text>
              )}
              {!options ? (
                <Text size="small" className="text-ui-fg-muted">Loading…</Text>
              ) : options.length === 0 ? (
                <Text size="small" className="text-ui-fg-muted">
                  No parts in this slot yet.
                </Text>
              ) : (
                options.map((o) => (
                  <div key={o.id} className="flex flex-col gap-1 border-b border-ui-border-base pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <Text size="small">
                        {o.label}
                        {o.is_fixed && (
                          <Badge size="2xsmall" className="ml-2">Fixed</Badge>
                        )}
                      </Text>
                      <Text size="small" className="tabular-nums">
                        {naira(o.indicative_price)}
                      </Text>
                    </div>
                    <Text size="small" className="text-ui-fg-muted">
                      {openCategory.attribute_schema
                        .filter((f) => o.attributes?.[f.key] !== undefined)
                        .map((f) => `${f.label}: ${showAttr(o.attributes[f.key])}`)
                        .join(" · ") || "No specs recorded"}
                    </Text>
                  </div>
                ))
              )}
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onClick={() => setImporting(openCategory)}>
                Bulk upload
              </Button>
              <Button onClick={() => setAdding(openCategory)}>Add a part</Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer>
      )}

      <OptionDrawer category={adding} onClose={() => setAdding(null)} onSaved={reload} />
      <ImportDrawer
        category={importing}
        onClose={() => setImporting(null)}
        onImported={reload}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Build Catalogue",
  icon: Microchip,
})

export default BuildCatalogPage
