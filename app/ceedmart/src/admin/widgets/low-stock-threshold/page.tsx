import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { fetchAdmin } from "../../lib/client"

// H6 — per-variant low-stock threshold editor. Sits on the product detail
// side rail. Reads current thresholds from each variant's metadata; on
// save it PATCHes each variant's metadata.low_stock_threshold in place
// via the admin variant endpoint. A blank input clears the override
// (variant falls back to LOW_STOCK_DEFAULT_THRESHOLD).

type VariantThresholdState = {
  id: string
  title: string | null
  sku: string | null
  threshold: string
}

const readInitialThreshold = (v: any): string => {
  const raw = (v?.metadata as any)?.low_stock_threshold
  if (raw == null || raw === "") return ""
  return String(raw)
}

const LowStockThresholdWidget = ({
  data: product,
}: DetailWidgetProps<AdminProduct>) => {
  const initial: VariantThresholdState[] = (product.variants ?? []).map((v) => ({
    id: v.id!,
    title: v.title ?? null,
    sku: v.sku ?? null,
    threshold: readInitialThreshold(v),
  }))
  const [rows, setRows] = useState<VariantThresholdState[]>(initial)
  const [saving, setSaving] = useState(false)

  const setRow = (id: string, patch: Partial<VariantThresholdState>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const changed = rows.filter((r) => {
        const original = initial.find((o) => o.id === r.id)
        return original && original.threshold !== r.threshold
      })
      if (changed.length === 0) {
        toast.info("No changes to save.")
        return
      }
      await Promise.all(
        changed.map((r) => {
          const parsed = r.threshold.trim() === "" ? null : Number(r.threshold)
          if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
            throw new Error(
              `Invalid threshold for ${r.title ?? r.sku ?? r.id}. Use a non-negative number or leave blank.`
            )
          }
          const existing =
            (product.variants ?? []).find((v) => v.id === r.id)?.metadata ?? {}
          const nextMeta = { ...(existing as Record<string, unknown>) }
          if (parsed === null) {
            delete nextMeta.low_stock_threshold
          } else {
            nextMeta.low_stock_threshold = parsed
          }
          return fetchAdmin(`/admin/products/${product.id}/variants/${r.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata: nextMeta }),
          })
        })
      )
      toast.success(`Updated ${changed.length} variant threshold${changed.length === 1 ? "" : "s"}`)
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save thresholds")
    } finally {
      setSaving(false)
    }
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <Container className="p-0 divide-y">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Low-stock alerts</Heading>
      </div>
      <div className="flex flex-col gap-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          When available stock at a location drops below the threshold, an
          email goes to the central inventory address. Leave blank to use
          the default (5). Set to 0 to disable alerts for that variant.
        </Text>
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              <Label htmlFor={`threshold-${r.id}`}>
                {r.title || r.sku || r.id}
              </Label>
              <Input
                id={`threshold-${r.id}`}
                type="number"
                min={0}
                value={r.threshold}
                onChange={(e) => setRow(r.id, { threshold: e.target.value })}
                placeholder="5"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={saveAll} isLoading={saving}>
            Save thresholds
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default LowStockThresholdWidget
