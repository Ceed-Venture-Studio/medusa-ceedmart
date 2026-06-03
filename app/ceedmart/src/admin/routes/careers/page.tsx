import { defineRouteConfig } from "@medusajs/admin-sdk"
import { UserGroup } from "@medusajs/icons"
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
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"
import { RichTextEditor } from "../../components/rich-text-editor"

// ─── Types ────────────────────────────────────────────────────────────────

type Requisition = {
  id: string
  title: string
  description: string
  apply_url: string
  salary: string | null
  status: "open" | "closed"
  created_at: string
  updated_at: string
}

type ListResp = {
  requisitions: Requisition[]
  count: number
  limit: number
  offset: number
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; requisition: Requisition }
  | null

// ─── Helpers ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

const relative = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Editor drawer ────────────────────────────────────────────────────────

type EditorProps = {
  mode: Editing
  onClose: () => void
  onSaved: () => void
}

// Inner form lives in its own component so we can `key` it on the
// requisition id (or "new"). Each open of the drawer mounts a fresh
// instance with state seeded directly from props — no useEffect race
// where the editor mounts with stale "" before useEffect catches up,
// and TipTap's initial content is correct on first render.
type FormProps = {
  initial: Requisition | null
  onCancel: () => void
  onSaved: () => void
  onClose: () => void
}

const EditorForm = ({ initial, onCancel, onSaved, onClose }: FormProps) => {
  const isEdit = initial !== null
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [applyUrl, setApplyUrl] = useState(initial?.apply_url ?? "")
  const [salary, setSalary] = useState(initial?.salary ?? "")
  const [status, setStatus] = useState<"open" | "closed">(
    initial?.status ?? "open"
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!title.trim() || !description.trim() || !applyUrl.trim()) {
      toast.error("Title, description, and apply link are required.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description,
        apply_url: applyUrl.trim(),
        salary: salary.trim() || null,
        status,
      }
      if (isEdit && initial) {
        await fetchAdmin(`/admin/requisitions/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        toast.success("Requisition updated")
      } else {
        await fetchAdmin(`/admin/requisitions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        toast.success("Requisition created")
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
          {isEdit ? "Edit requisition" : "New requisition"}
        </Drawer.Title>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <Label htmlFor="title">Role title *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior Solar Sales Engineer"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="apply_url">Application link *</Label>
          <Input
            id="apply_url"
            type="url"
            value={applyUrl}
            onChange={(e) => setApplyUrl(e.target.value)}
            placeholder="https://forms.gle/..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="salary">Salary (optional)</Label>
          <Input
            id="salary"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="₦400k – ₦600k / month"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as "open" | "closed")}
          >
            <Select.Trigger id="status">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="open">Open</Select.Item>
              <Select.Item value="closed">Closed</Select.Item>
            </Select.Content>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="description">Description *</Label>
          <Text size="small" className="text-ui-fg-subtle">
            Headings, bold, lists, and links are rendered on the public
            careers page.
          </Text>
          <RichTextEditor
            id="description"
            value={description}
            onChange={setDescription}
            placeholder="Describe the role, responsibilities, and ideal candidate…"
          />
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} isLoading={saving}>
          {isEdit ? "Save changes" : "Create"}
        </Button>
      </Drawer.Footer>
    </>
  )
}

const RequisitionEditor = ({ mode, onClose, onSaved }: EditorProps) => {
  const initial = mode?.mode === "edit" ? mode.requisition : null
  // Force a remount each time the drawer transitions to a new instance.
  // Without this, the inputs and TipTap editor reuse stale internal state
  // (TipTap especially — its first-mount content is sticky, so editing role
  // B after role A would still show A's description until you typed).
  const formKey = mode === null
    ? "closed"
    : mode.mode === "edit"
      ? `edit-${mode.requisition.id}`
      : "new"

  return (
    <Drawer open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        {mode !== null && (
          <EditorForm
            key={formKey}
            initial={initial}
            onCancel={onClose}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

const CareersPage = () => {
  const [list, setList] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  // Radix Select disallows empty-string item values, so the "All" option
  // uses a sentinel that we map back to "no filter" at query-build time.
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">(
    "all"
  )
  const [offset, setOffset] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const [editor, setEditor] = useState<Editing>(null)
  const [debouncedQ, setDebouncedQ] = useState("")

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = list ? Math.max(1, Math.ceil(list.count / PAGE_SIZE)) : 1

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setOffset(0)
  }, [debouncedQ, statusFilter])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    if (debouncedQ) params.set("q", debouncedQ)
    if (statusFilter !== "all") params.set("status", statusFilter)
    fetchAdmin<ListResp>(`/admin/requisitions?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setList(data)
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
  }, [offset, debouncedQ, statusFilter, refreshTick])

  const handleDelete = async (r: Requisition) => {
    if (!window.confirm(`Delete "${r.title}"? This can't be undone.`)) return
    try {
      await fetchAdmin(`/admin/requisitions/${r.id}`, { method: "DELETE" })
      toast.success("Requisition deleted")
      setRefreshTick((n) => n + 1)
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete")
    }
  }

  const rows = useMemo(() => list?.requisitions ?? [], [list])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Careers</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage open hiring requisitions. Each one is published on{" "}
            <code className="text-ui-fg-base">/careers</code> until you mark it
            closed.
          </Text>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>New posting</Button>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[240px]">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Role title…"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Label htmlFor="status-filter">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as any)}
            >
              <Select.Trigger id="status-filter">
                <Select.Value placeholder="All" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All</Select.Item>
                <Select.Item value="open">Open</Select.Item>
                <Select.Item value="closed">Closed</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Salary</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Apply</Table.HeaderCell>
              <Table.HeaderCell>Created</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && !loading ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    No requisitions yet. Create the first one with “New
                    posting”.
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    <Text weight="plus">{r.title}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {r.salary || "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={r.status === "open" ? "green" : "grey"}>
                      {r.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <a
                      href={r.apply_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ui-fg-interactive underline"
                    >
                      link
                    </a>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {relative(r.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex gap-2">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() =>
                          setEditor({ mode: "edit", requisition: r })
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

        <div className="mt-2 flex items-center justify-between">
          <Text size="small" className="text-ui-fg-muted">
            {list
              ? `Showing ${
                  list.requisitions.length === 0 ? 0 : offset + 1
                }–${offset + list.requisitions.length} of ${list.count}`
              : "—"}
          </Text>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Text size="small" className="text-ui-fg-muted">
              Page {page} of {totalPages}
            </Text>
            <Button
              size="small"
              variant="secondary"
              disabled={!list || offset + PAGE_SIZE >= list.count || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <RequisitionEditor
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={() => setRefreshTick((n) => n + 1)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Careers",
  icon: UserGroup,
})

export default CareersPage
