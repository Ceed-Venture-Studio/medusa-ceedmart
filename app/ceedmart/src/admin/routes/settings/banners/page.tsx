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
import { fetchAdmin } from "../../../lib/client"

// ─── Types ────────────────────────────────────────────────────────────────

type ImageSpec = {
  aspect_ratio: number
  min_width: number
  min_height: number
}

type BannerSlot = ImageSpec & {
  key: string
  label: string
  description: string
  mobile?: ImageSpec
  overlay: "hero" | "carousel" | "none"
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
  mobile_image_url: string | null
  mobile_image_key: string | null
  mobile_image_width: number | null
  mobile_image_height: number | null
  mobile_image_mime_type: string | null
  link_url: string | null
  cta_1_label: string | null
  cta_2_url: string | null
  cta_2_label: string | null
  eyebrow: string | null
  headline: string | null
  headline_highlight: string | null
  subheadline: string | null
  primary_color: string | null
  secondary_color: string | null
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

type UploadedImage = {
  url: string
  key: string | null
  width: number
  height: number
  mime_type: string
}

type HeroCard = {
  icon: string
  title: string
  body: string | null
  link_url: string | null
  accent_color: string | null
}

type HeroCardsResp = {
  cards: HeroCard[]
  is_default: boolean
  defaults: HeroCard[]
  icons: string[]
  max: number
}

type ListResp = { banners: Banner[]; count: number; limit: number; offset: number }
type SlotsResp = { slots: BannerSlot[] }

const PAGE_SIZE = 20
const STATUSES: Banner["status"][] = ["draft", "active", "archived"]
const DEFAULT_BG = "#05007F"
const DEFAULT_FG = "#FFFFFF"

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  // FormData (banner uploads) — fetchAdmin handles both JSON and binary bodies.
  return (await fetchAdmin<T>(url, init)) as Awaited<T>
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

const specText = (s: ImageSpec) =>
  `aspect ${s.aspect_ratio.toFixed(3)} · at least ${s.min_width}×${s.min_height}px`

const imageOf = (b: Banner, variant: "desktop" | "mobile"): UploadedImage | null => {
  if (variant === "desktop") {
    return {
      url: b.image_url,
      key: b.image_key,
      width: b.image_width,
      height: b.image_height,
      mime_type: b.image_mime_type,
    }
  }
  return b.mobile_image_url
    ? {
        url: b.mobile_image_url,
        key: b.mobile_image_key,
        width: b.mobile_image_width ?? 0,
        height: b.mobile_image_height ?? 0,
        mime_type: b.mobile_image_mime_type ?? "",
      }
    : null
}

// ─── Image picker ─────────────────────────────────────────────────────────

const ImagePicker = ({
  label,
  hint,
  slot,
  variant,
  value,
  onChange,
}: {
  label: string
  hint: string
  slot: string
  variant: "desktop" | "mobile"
  value: UploadedImage | null
  onChange: (img: UploadedImage | null) => void
}) => {
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    const form = new FormData()
    form.append("file", file)
    form.append("slot", slot)
    form.append("variant", variant)
    try {
      const r = await fetchJson<{
        image_url: string; image_key: string; image_width: number
        image_height: number; image_mime_type: string
      }>("/admin/banners/upload", { method: "POST", body: form })
      onChange({
        url: r.image_url,
        key: r.image_key,
        width: r.image_width,
        height: r.image_height,
        mime_type: r.image_mime_type,
      })
      toast.success(`Uploaded ${r.image_width}×${r.image_height}`)
    } catch (e: any) {
      toast.error(`Upload rejected: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  const input = (
    <Input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      disabled={uploading || !slot}
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) upload(f)
        e.target.value = ""
      }}
    />
  )

  return (
    <div>
      <Label>{label}</Label>
      <Text size="xsmall" className="text-ui-fg-muted mb-1">{hint}</Text>
      {value ? (
        <div className="border-ui-border-base rounded-lg overflow-hidden border bg-ui-bg-subtle">
          <img src={value.url} alt="preview" className="max-h-48 w-auto mx-auto" />
          <div className="px-3 py-2 flex flex-col gap-2">
            <Text size="xsmall" className="text-ui-fg-muted">
              {value.width}×{value.height} {value.mime_type.split("/")[1]?.toUpperCase()} · replace:
            </Text>
            {input}
          </div>
        </div>
      ) : (
        input
      )}
      {uploading && <Text size="xsmall" className="text-ui-fg-muted">Uploading and validating…</Text>}
    </div>
  )
}

const ColorField = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) => (
  <div>
    <Label>{label}</Label>
    <div className="flex items-center gap-2">
      <Input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-14 p-1" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  </div>
)

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
  const [name, setName] = useState("")
  const [slot, setSlot] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [cta1Label, setCta1Label] = useState("")
  const [cta2Url, setCta2Url] = useState("")
  const [cta2Label, setCta2Label] = useState("")
  const [eyebrow, setEyebrow] = useState("")
  const [headline, setHeadline] = useState("")
  const [highlight, setHighlight] = useState("")
  const [subheadline, setSubheadline] = useState("")
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BG)
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_FG)
  const [altText, setAltText] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [priority, setPriority] = useState(0)
  const [status, setStatus] = useState<Banner["status"]>("draft")
  const [desktop, setDesktop] = useState<UploadedImage | null>(null)
  const [mobile, setMobile] = useState<UploadedImage | null>(null)
  const [saving, setSaving] = useState(false)

  const currentSlot = useMemo(() => slots.find((s) => s.key === slot), [slot, slots])
  const overlay = currentSlot?.overlay ?? "none"

  // Re-prime form when mode changes (open/close lifecycle).
  useEffect(() => {
    if (!mode) return
    const b = mode.kind === "edit" ? mode.banner : null
    setName(b?.name ?? "")
    setSlot(b?.slot ?? slots[0]?.key ?? "")
    setLinkUrl(b?.link_url ?? "")
    setCta1Label(b?.cta_1_label ?? "")
    setCta2Url(b?.cta_2_url ?? "")
    setCta2Label(b?.cta_2_label ?? "")
    setEyebrow(b?.eyebrow ?? "")
    setHeadline(b?.headline ?? "")
    setHighlight(b?.headline_highlight ?? "")
    setSubheadline(b?.subheadline ?? "")
    setPrimaryColor(b?.primary_color ?? DEFAULT_BG)
    setSecondaryColor(b?.secondary_color ?? DEFAULT_FG)
    setAltText(b?.alt_text ?? "")
    setStartsAt(b?.starts_at?.slice(0, 16) ?? "")
    setEndsAt(b?.ends_at?.slice(0, 16) ?? "")
    setPriority(b?.priority ?? 0)
    setStatus(b?.status ?? "draft")
    setDesktop(b ? imageOf(b, "desktop") : null)
    setMobile(b ? imageOf(b, "mobile") : null)
  }, [mode, slots])

  // Images belong to a slot's dimensions; a new slot needs new images.
  const changeSlot = (key: string) => {
    setSlot(key)
    setDesktop(null)
    setMobile(null)
  }

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return }
    if (!desktop) { toast.error("Upload the desktop image first"); return }
    if (currentSlot?.mobile && !mobile) {
      toast.error("Upload the mobile image too — phones would otherwise show a cropped desktop image")
      return
    }
    setSaving(true)
    try {
      const text = {
        link_url: linkUrl || null,
        cta_1_label: overlay === "none" ? null : cta1Label || null,
        cta_2_url: overlay === "none" ? null : cta2Url || null,
        cta_2_label: overlay === "none" ? null : cta2Label || null,
        eyebrow: overlay === "hero" ? eyebrow || null : null,
        headline: overlay === "none" ? null : headline || null,
        headline_highlight: overlay === "hero" ? highlight || null : null,
        subheadline: overlay === "none" ? null : subheadline || null,
        primary_color: overlay === "none" ? null : primaryColor || null,
        secondary_color: overlay === "none" ? null : secondaryColor || null,
        alt_text: altText || null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        priority,
        status,
      }
      if (editing) {
        await fetchJson<{ banner: Banner }>(`/admin/banners/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ...text,
            ...(desktop.url !== editing.image_url ? { image: desktop } : {}),
            ...((mobile?.url ?? null) !== editing.mobile_image_url ? { mobile_image: mobile } : {}),
          }),
        })
        toast.success("Banner updated")
      } else {
        await fetchJson<{ banner: Banner }>("/admin/banners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            slot,
            image_url: desktop.url,
            image_key: desktop.key,
            image_width: desktop.width,
            image_height: desktop.height,
            image_mime_type: desktop.mime_type,
            ...(mobile
              ? {
                  mobile_image_url: mobile.url,
                  mobile_image_key: mobile.key,
                  mobile_image_width: mobile.width,
                  mobile_image_height: mobile.height,
                  mobile_image_mime_type: mobile.mime_type,
                }
              : {}),
            ...text,
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Black Friday — home hero" />
          </div>

          <div>
            <Label>Slot</Label>
            <Select value={slot} onValueChange={changeSlot} disabled={!!editing}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>
                {slots.map((s) => (
                  <Select.Item key={s.key} value={s.key}>{s.label}</Select.Item>
                ))}
              </Select.Content>
            </Select>
            {currentSlot && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">{currentSlot.description}</Text>
            )}
          </div>

          {currentSlot && (
            <ImagePicker
              label={currentSlot.mobile ? "Desktop image" : "Image"}
              hint={specText(currentSlot)}
              slot={slot}
              variant="desktop"
              value={desktop}
              onChange={setDesktop}
            />
          )}
          {currentSlot?.mobile && (
            <ImagePicker
              label="Mobile image"
              hint={`Shown on phones · ${specText(currentSlot.mobile)}`}
              slot={slot}
              variant="mobile"
              value={mobile}
              onChange={setMobile}
            />
          )}

          <div>
            <Label>Alt text</Label>
            <Input value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Describe the image for screen readers" />
          </div>

          {overlay === "none" && (
            <div>
              <Label>Click-through link (optional)</Label>
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/store/wholefoods" />
            </div>
          )}

          {overlay === "hero" && (
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 flex flex-col gap-3">
              <Text size="small" weight="plus">Slide text and buttons</Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                Shown over the image, with the search bar below. Leave any field blank to hide it.
              </Text>
              <div>
                <Label>Badge</Label>
                <Input value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} placeholder="Wholesale & bulk supply" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Headline</Label>
                  <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Buy in bulk." />
                </div>
                <div>
                  <Label>Highlighted line</Label>
                  <Input value={highlight} onChange={(e) => setHighlight(e.target.value)} placeholder="Pay less per unit." />
                </div>
              </div>
              <div>
                <Label>Paragraph</Label>
                <Textarea value={subheadline} onChange={(e) => setSubheadline(e.target.value)} rows={3} placeholder="Foods, solar, security and IT — supplied at quantity…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Button 1 label</Label>
                  <Input value={cta1Label} onChange={(e) => setCta1Label(e.target.value)} placeholder="Browse the catalogue" />
                </div>
                <div>
                  <Label>Button 1 link</Label>
                  <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/store" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Button 2 label</Label>
                  <Input value={cta2Label} onChange={(e) => setCta2Label(e.target.value)} placeholder="Get a solar estimate" />
                </div>
                <div>
                  <Label>Button 2 link</Label>
                  <Input value={cta2Url} onChange={(e) => setCta2Url(e.target.value)} placeholder="/solar" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField label="Shade behind the text" value={primaryColor} onChange={setPrimaryColor} placeholder={DEFAULT_BG} />
                <ColorField label="Text colour" value={secondaryColor} onChange={setSecondaryColor} placeholder={DEFAULT_FG} />
              </div>
              <Text size="xsmall" className="text-ui-fg-muted">
                A button shows only when it has both a label and a link.
              </Text>

              <div
                className="relative rounded-md overflow-hidden text-sm mt-1"
                style={{ backgroundColor: primaryColor }}
              >
                {desktop && <img src={desktop.url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                <div
                  className="relative p-4 flex flex-col gap-1.5"
                  style={{
                    color: secondaryColor,
                    background: `linear-gradient(to right, ${primaryColor}E6, ${primaryColor}80 60%, transparent)`,
                  }}
                >
                  {eyebrow && <span className="self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-white/15">{eyebrow}</span>}
                  {(headline || highlight) && (
                    <div className="font-bold text-lg leading-tight">
                      {headline}
                      {highlight && <><br /><span style={{ color: "#FFCE00" }}>{highlight}</span></>}
                    </div>
                  )}
                  {subheadline && <div className="opacity-80 text-xs max-w-sm">{subheadline}</div>}
                  <div className="mt-1 rounded-full bg-white/90 text-ui-fg-muted text-[10px] px-3 py-1.5 max-w-xs">Search bar</div>
                  <div className="flex gap-2 mt-1">
                    {cta1Label && linkUrl && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: "#FFCE00", color: "#05007F" }}>{cta1Label}</span>}
                    {cta2Label && cta2Url && <span className="rounded-full px-3 py-1 text-xs font-semibold border" style={{ borderColor: secondaryColor }}>{cta2Label}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {overlay === "carousel" && (
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 flex flex-col gap-3">
              <Text size="small" weight="plus">Carousel overlay (headline, colors, CTAs)</Text>
              <div>
                <Label>Headline</Label>
                <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Power up your home or business" />
              </div>
              <div>
                <Label>Subheadline</Label>
                <Textarea value={subheadline} onChange={(e) => setSubheadline(e.target.value)} rows={2} placeholder="Solar systems and CCTV kit at great prices." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField label="Primary color (background)" value={primaryColor} onChange={setPrimaryColor} placeholder={DEFAULT_BG} />
                <ColorField label="Secondary color (text)" value={secondaryColor} onChange={setSecondaryColor} placeholder={DEFAULT_FG} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>CTA 1 label</Label>
                  <Input value={cta1Label} onChange={(e) => setCta1Label(e.target.value)} placeholder="Shop now" />
                </div>
                <div>
                  <Label>CTA 1 URL</Label>
                  <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/collections/solar" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>CTA 2 label (optional)</Label>
                  <Input value={cta2Label} onChange={(e) => setCta2Label(e.target.value)} placeholder="Learn more" />
                </div>
                <div>
                  <Label>CTA 2 URL (optional)</Label>
                  <Input value={cta2Url} onChange={(e) => setCta2Url(e.target.value)} placeholder="/solar" />
                </div>
              </div>
            </div>
          )}

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
              <Text size="xsmall" className="text-ui-fg-muted">
                {overlay === "hero" ? "Slide order: higher shows first." : "Higher first."}
              </Text>
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
            <Button onClick={save} isLoading={saving} disabled={saving || !desktop || !name.trim()}>
              {editing ? "Save changes" : "Create banner"}
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Home hero cards ──────────────────────────────────────────────────────

const ICON_LABELS: Record<string, string> = {
  delivery: "Delivery truck",
  support: "Headset",
  plane: "Plane",
  whatsapp: "WhatsApp",
  tag: "Price tag",
  shield: "Shield",
  clock: "Clock",
  star: "Star",
}

const HeroCardsEditor = () => {
  const [data, setData] = useState<HeroCardsResp | null>(null)
  const [cards, setCards] = useState<HeroCard[]>([])
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const load = () =>
    fetchJson<HeroCardsResp>("/admin/banners/hero-cards")
      .then((r) => { setData(r); setCards(r.cards) })
      .catch((e: any) => toast.error(`Could not load hero cards: ${e.message}`))

  useEffect(() => { load() }, [])

  const update = (i: number, patch: Partial<HeroCard>) =>
    setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, by: number) =>
    setCards((cs) => {
      const j = i + by
      if (j < 0 || j >= cs.length) return cs
      const next = [...cs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const post = async (body: { cards: HeroCard[] | null }, done: string) => {
    setSaving(true)
    try {
      await fetchJson("/admin/banners/hero-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      toast.success(done)
      await load()
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h2">Home hero cards</Heading>
            {data?.is_default && <Badge size="2xsmall">Built-in defaults</Badge>}
          </div>
          <Text size="small" className="text-ui-fg-muted">
            The cards under the home hero (delivery, support, …). Shown under every slide, and under the built-in hero when no slide is active.
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : `Edit cards (${cards.length})`}
        </Button>
      </div>

      {open && data && (
        <div className="flex flex-col gap-3">
          {cards.length === 0 && (
            <Text size="small" className="text-ui-fg-muted">No cards — the row under the hero is hidden.</Text>
          )}
          {cards.map((c, i) => (
            <div key={i} className="rounded-lg border border-ui-border-base p-3 grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label>Icon</Label>
                <Select value={c.icon} onValueChange={(v) => update(i, { icon: v })}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    {data.icons.map((ic) => (
                      <Select.Item key={ic} value={ic}>{ICON_LABELS[ic] ?? ic}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="col-span-4">
                <Label>Title</Label>
                <Input value={c.title} maxLength={60} onChange={(e) => update(i, { title: e.target.value })} />
              </div>
              <div className="col-span-5">
                <Label>Text (optional)</Label>
                <Input value={c.body ?? ""} maxLength={120} onChange={(e) => update(i, { body: e.target.value })} />
              </div>
              <div className="col-span-5">
                <Label>Link (optional)</Label>
                <Input value={c.link_url ?? ""} placeholder="/pre-orders or https://wa.me/…" onChange={(e) => update(i, { link_url: e.target.value })} />
              </div>
              <div className="col-span-4">
                <Label>Card colour (optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={c.accent_color ?? "#ffffff"}
                    onChange={(e) => update(i, { accent_color: e.target.value })}
                    className="h-9 w-14 p-1"
                  />
                  <Input
                    value={c.accent_color ?? ""}
                    placeholder="Standard"
                    onChange={(e) => update(i, { accent_color: e.target.value || null })}
                  />
                </div>
              </div>
              <div className="col-span-3 flex justify-end gap-1">
                <Button size="small" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button size="small" variant="secondary" disabled={i === cards.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Button size="small" variant="danger" onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between">
            <Button
              size="small"
              variant="secondary"
              disabled={cards.length >= data.max}
              onClick={() =>
                setCards((cs) => [...cs, { icon: "tag", title: "", body: null, link_url: null, accent_color: null }])
              }
            >
              Add card {cards.length >= data.max ? `(max ${data.max})` : ""}
            </Button>
            <div className="flex gap-2">
              <Button
                size="small"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  if (confirm("Go back to the built-in cards? Your edits are discarded.")) {
                    post({ cards: null }, "Back to the built-in cards")
                  }
                }}
              >
                Reset to defaults
              </Button>
              <Button size="small" isLoading={saving} disabled={saving} onClick={() => post({ cards }, "Hero cards saved")}>
                Save cards
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
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
    if (!confirm(`Delete "${b.name}"? This removes the image${b.mobile_image_url ? "s" : ""} too.`)) return
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

      <HeroCardsEditor />

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
                    <div className="flex items-center gap-1">
                      <img src={b.image_url} alt="" className="h-10 w-16 object-cover rounded" />
                      {b.mobile_image_url && <img src={b.mobile_image_url} alt="" className="h-10 w-8 object-cover rounded" />}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">{b.name}</Text>
                    {(b.headline || b.headline_highlight) && (
                      <Text size="xsmall" className="text-ui-fg-muted truncate">
                        {[b.headline, b.headline_highlight].filter(Boolean).join(" ")}
                      </Text>
                    )}
                    {b.link_url && <Text size="xsmall" className="text-ui-fg-muted truncate" title={b.link_url}>↗ {b.link_url}</Text>}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{slots.find((s) => s.key === b.slot)?.label ?? b.slot}</Badge>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {b.image_width}×{b.image_height}
                      {b.mobile_image_url ? ` · mobile ${b.mobile_image_width}×${b.mobile_image_height}` : ""}
                    </Text>
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
