import { defineRouteConfig } from "@medusajs/admin-sdk"
import { PhotoSolid } from "@medusajs/icons"
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
import { useEffect, useMemo, useState } from "react"

// ─── Types ────────────────────────────────────────────────────────────────

type BannerSlot = {
  key: string
  label: string
  aspect_ratio: number
  min_width: number
  min_height: number
  description: string
}

type Banner = {
  id: string
  name: string
  slot: string
  image_url: string
  image_key: string | null
  image_width: number
  image_height: number
  image_mime_type: string
  link_url: string | null
  alt_text: string | null
  starts_at: string | null
  ends_at: string | null
  priority: number
  status: "draft" | "active" | "archived"
  sales_channel_id: string | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

type ListResp = { banners: Banner[]; count: number; limit: number; offset: number }
type SlotsResp = { slots: BannerSlot[] }

const PAGE_SIZE = 20
const STATUSES: Banner["status"][] = ["draft", "active", "archived"]

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { credentials: "include", ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

const relative = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const statusColor = (s: Banner["status"]): "grey" | "blue" | "green" | "orange" => {
  if (s === "active") return "green"
  if (s === "archived") return "grey"
  return "orange"
}

// ─── Editor drawer ────────────────────────────────────────────────────────

type EditorMode = { kind: "create" } | { kind: "edit"; banner: Banner } | null

const BannerEditor = ({
  mode,
  slots,
  onClose,
  onSaved,
}: {
  mode: EditorMode
  slots: BannerSlot[]
  onClose: () => void
  onSaved: () => void
}) => {
  const editing = mode?.kind === "edit" ? mode.banner : null
  const [name, setName] = useState(editing?.name ?? "")
  const [slot, setSlot] = useState(editing?.slot ?? slots[0]?.key ?? "")
  const [linkUrl, setLinkUrl] = useState(editing?.link_url ?? "")
  const [altText, setAltText] = useState(editing?.alt_text ?? "")
  const [startsAt, setStartsAt] = useState(editing?.starts_at?.slice(0, 16) ?? "")
  const [endsAt, setEndsAt] = useState(editing?.ends_at?.slice(0, 16) ?? "")
  const [priority, setPriority] = useState(editing?.priority ?? 0)
  const [status, setStatus] = useState<Banner["status"]>(editing?.status ?? "draft")

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imageUrl, setImageUrl] = useState(editing?.image_url ?? "")
  const [imageKey, setImageKey] = useState(editing?.image_key ?? "")
  const [imageWidth, setImageWidth] = useState(editing?.image_width ?? 0)
  const [imageHeight, setImageHeight] = useState(editing?.image_height ?? 0)
  const [imageMime, setImageMime] = useState(editing?.image_mime_type ?? "")

  const currentSlot = useMemo(() => slots.find((s) => s.key === slot), [slot, slots])

  // Re-prime form when mode changes (open/close lifecycle).
  useEffect(() => {
    if (!mode) return
    if (mode.kind === "edit") {
      const b = mode.banner
      setName(b.name); setSlot(b.slot); setLinkUrl(b.link_url ?? "")
      setAltText(b.alt_text ?? ""); setStartsAt(b.starts_at?.slice(0, 16) ?? "")
      setEndsAt(b.ends_at?.slice(0, 16) ?? ""); setPriority(b.priority)
      setStatus(b.status); setImageUrl(b.image_url); setImageKey(b.image_key ?? "")
      setImageWidth(b.image_width); setImageHeight(b.image_height); setImageMime(b.image_mime_type)
    } else {
      setName(""); setSlot(slots[0]?.key ?? ""); setLinkUrl(""); setAltText("")
      setStartsAt(""); setEndsAt(""); setPriority(0); setStatus("draft")
      setImageUrl(""); setImageKey(""); setImageWidth(0); setImageHeight(0); setImageMime("")
    }
  }, [mode, slots])

  const handleFile = async (file: File) => {
    if (!slot) {
      toast.error("Pick a slot first")
      return
    }
    setUploading(true)
    const form = new FormData()
    form.append("file", file)
    form.append("slot", slot)
    try {
      const r = await fetchJson<{
        image_url: string; image_key: string; image_width: number;
        image_height: number; image_mime_type: string;
      }>("/admin/banners/upload", { method: "POST", body: form })
      setImageUrl(r.image_url); setImageKey(r.image_key)
      setImageWidth(r.image_width); setImageHeight(r.image_height); setImageMime(r.image_mime_type)
      toast.success(`Uploaded ${r.image_width}×${r.image_height}`)
    } catch (e: any) {
      toast.error(`Upload rejected: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return }
    if (!imageUrl) { toast.error("Upload an image first"); return }
    setSaving(true)
    try {
      if (editing) {
        await fetchJson<{ banner: Banner }>(`/admin/banners/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, slot, link_url: linkUrl || null, alt_text: altText || null,
            starts_at: startsAt || null, ends_at: endsAt || null,
            priority, status,
          }),
        })
        toast.success("Banner updated")
      } else {
        await fetchJson<{ banner: Banner }>("/admin/banners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, slot, image_url: imageUrl, image_key: imageKey || null,
            image_width: imageWidth, image_height: imageHeight, image_mime_type: imageMime,
            link_url: linkUrl || null, alt_text: altText || null,
            starts_at: startsAt || null, ends_at: endsAt || null,
            priority, status,
          }),
        })
        toast.success("Banner created")
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
          <Drawer.Title>{editing ? "Edit banner" : "New banner"}</Drawer.Title>
          <Drawer.Description>{editing ? editing.id : "Upload a banner image, set its placement, and schedule it."}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring Sale — desktop hero" />
          </div>

          <div>
            <Label>Slot</Label>
            <Select value={slot} onValueChange={setSlot} disabled={!!editing}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>
                {slots.map((s) => (
                  <Select.Item key={s.key} value={s.key}>{s.label}</Select.Item>
                ))}
              </Select.Content>
            </Select>
            {currentSlot && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                {currentSlot.description} · aspect {currentSlot.aspect_ratio.toFixed(3)} · min {currentSlot.min_width}×{currentSlot.min_height}
              </Text>
            )}
          </div>

          <div>
            <Label>Image</Label>
            {imageUrl ? (
              <div className="border-ui-border-base rounded-lg overflow-hidden border bg-ui-bg-subtle">
                <img src={imageUrl} alt="preview" className="max-h-48 w-auto mx-auto" />
                <div className="px-3 py-2 text-xs text-ui-fg-muted flex justify-between">
                  <span>{imageWidth}×{imageHeight} {imageMime.split("/")[1]?.toUpperCase()}</span>
                  {!editing && (
                    <button onClick={() => { setImageUrl(""); setImageKey(""); }} className="hover:underline">
                      Replace
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading || !slot}
                onChange={(e) => {
                  const f = e.target.files?.[0]; if (f) handleFile(f)
                }}
              />
            )}
            {uploading && <Text size="xsmall" className="text-ui-fg-muted">Uploading and validating…</Text>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Link URL (optional)</Label>
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label>Alt text</Label>
              <Input value={altText} onChange={(e) => setAltText(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Starts at</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <Label>Ends at</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
              <Text size="xsmall" className="text-ui-fg-muted">Higher first.</Text>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Banner["status"])}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {STATUSES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
                </Select.Content>
              </Select>
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex w-full justify-end gap-2">
            <Drawer.Close asChild><Button variant="secondary">Cancel</Button></Drawer.Close>
            <Button onClick={save} isLoading={saving} disabled={saving || uploading || !imageUrl || !name.trim()}>
              {editing ? "Save changes" : "Create banner"}
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const BannersPage = () => {
  const [slots, setSlots] = useState<BannerSlot[]>([])
  const [list, setList] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [slotFilter, setSlotFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [offset, setOffset] = useState(0)
  const [editor, setEditor] = useState<EditorMode>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setOffset(0) }, [debouncedQ, slotFilter, statusFilter])

  useEffect(() => {
    fetchJson<SlotsResp>("/admin/banners/slots").then((r) => setSlots(r.slots)).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (debouncedQ) params.set("q", debouncedQ)
    if (slotFilter !== "all") params.set("slot", slotFilter)
    if (statusFilter !== "all") params.set("status", statusFilter)
    fetchJson<ListResp>(`/admin/banners?${params}`)
      .then((d) => { if (!cancelled) setList(d) })
      .catch(() => { if (!cancelled) setList(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQ, slotFilter, statusFilter, offset, refreshTick])

  const deleteBanner = async (b: Banner) => {
    if (!confirm(`Delete "${b.name}"? This removes the image too.`)) return
    try {
      await fetchJson(`/admin/banners/${b.id}`, { method: "DELETE" })
      toast.success("Banner deleted")
      setRefreshTick((n) => n + 1)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Banners</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Promotional banners shown across the storefront. Strict aspect ratios per slot.
          </Text>
        </div>
        <Button size="small" onClick={() => setEditor({ kind: "create" })}>New banner</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="w-64">
          <Input placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={slotFilter} onValueChange={setSlotFilter}>
          <Select.Trigger className="w-56"><Select.Value /></Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All slots</Select.Item>
            {slots.map((s) => <Select.Item key={s.key} value={s.key}>{s.label}</Select.Item>)}
          </Select.Content>
        </Select>
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
              <Table.HeaderCell>Preview</Table.HeaderCell>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Slot</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Schedule</Table.HeaderCell>
              <Table.HeaderCell>Priority</Table.HeaderCell>
              <Table.HeaderCell>Updated</Table.HeaderCell>
              <Table.HeaderCell></Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && !list ? (
              <Table.Row><Table.Cell colSpan={8}><Text size="small" className="text-ui-fg-muted">Loading…</Text></Table.Cell></Table.Row>
            ) : list && list.banners.length > 0 ? (
              list.banners.map((b) => (
                <Table.Row key={b.id} className="cursor-pointer" onClick={() => setEditor({ kind: "edit", banner: b })}>
                  <Table.Cell>
                    <img src={b.image_url} alt="" className="h-10 w-16 object-cover rounded" />
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">{b.name}</Text>
                    {b.link_url && <Text size="xsmall" className="text-ui-fg-muted truncate" title={b.link_url}>↗ {b.link_url}</Text>}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{slots.find((s) => s.key === b.slot)?.label ?? b.slot}</Badge>
                    <Text size="xsmall" className="text-ui-fg-muted">{b.image_width}×{b.image_height}</Text>
                  </Table.Cell>
                  <Table.Cell><StatusBadge color={statusColor(b.status)}>{b.status}</StatusBadge></Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall">{b.starts_at ? new Date(b.starts_at).toLocaleDateString() : "—"} → {b.ends_at ? new Date(b.ends_at).toLocaleDateString() : "—"}</Text>
                  </Table.Cell>
                  <Table.Cell><Text size="small">{b.priority}</Text></Table.Cell>
                  <Table.Cell><Text size="small">{relative(b.updated_at)}</Text></Table.Cell>
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    <Button size="small" variant="danger" onClick={() => deleteBanner(b)}>Delete</Button>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row><Table.Cell colSpan={8}><Text size="small" className="text-ui-fg-muted">No banners match.</Text></Table.Cell></Table.Row>
            )}
          </Table.Body>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list ? `Showing ${list.banners.length === 0 ? 0 : offset + 1}–${offset + list.banners.length} of ${list.count}` : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button size="small" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Text size="small" className="text-ui-fg-muted">Page {page} of {totalPages}</Text>
            <Button size="small" variant="secondary" disabled={!list || offset + PAGE_SIZE >= list.count || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </div>

      <BannerEditor
        mode={editor}
        slots={slots}
        onClose={() => setEditor(null)}
        onSaved={() => setRefreshTick((n) => n + 1)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Banners",
  icon: PhotoSolid,
})

export default BannersPage
