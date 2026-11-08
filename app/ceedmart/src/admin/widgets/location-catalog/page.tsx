import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import {
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { fetchAdmin } from "../../lib/client"

// Location prices and availability for one product (lib/location-catalog).
//
// One table: an "All variants" row that every variant inherits, then a row
// per variant that can override it. Columns are the states Ceedmart sells
// in, read from the shops and web locations. A blank price means "inherit"
// — the product's price for a variant, the national price for the product.
// Unticking "Sold here" keeps the item listed but marked unavailable there;
// to hide a product from a city entirely, remove its "Web – <city>" sales
// channel instead.

type Location = { province: string; name: string; channels: { id: string; name: string }[] }
type PriceRow = { variant_id: string | null; province: string; currency_code: string; amount: number }
type AvailRow = { variant_id: string | null; province: string; is_available: boolean }

// Keyed "<variantId or ''>|<province>".
type PriceDraft = Record<string, string>
type AvailDraft = Record<string, boolean>

const PRODUCT = ""
const key = (variantId: string | null, province: string) => `${variantId ?? PRODUCT}|${province}`

const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount)

const LocationCatalogWidget = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const [locations, setLocations] = useState<Location[]>([])
  const [unmapped, setUnmapped] = useState<{ id: string; name: string; state: string | null }[]>([])
  const [currency, setCurrency] = useState("ngn")
  const [prices, setPrices] = useState<PriceDraft>({})
  const [avail, setAvail] = useState<AvailDraft>({})
  const [loaded, setLoaded] = useState<{ prices: PriceDraft; avail: AvailDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variants = product.variants ?? []

  const nationalPrice = (variantId: string): number | null => {
    const v: any = variants.find((x) => x.id === variantId)
    const p = (v?.prices ?? []).find(
      (p: any) =>
        p.currency_code === currency &&
        !p.price_list_id &&
        !Object.keys(p.rules ?? {}).some((r) => r === "province")
    )
    return p ? Number(p.amount) : null
  }

  const load = async () => {
    setError(null)
    try {
      const [locs, cat] = await Promise.all([
        fetchAdmin<{ currency_code: string; locations: Location[]; unmapped_channels: any[] }>(
          "/admin/location-catalog/locations"
        ),
        fetchAdmin<{ location_catalog: { prices: PriceRow[]; availability: AvailRow[] } }>(
          `/admin/products/${product.id}/location-catalog`
        ),
      ])
      setLocations(locs.locations)
      setUnmapped(locs.unmapped_channels)
      setCurrency(locs.currency_code)

      const p: PriceDraft = {}
      for (const r of cat.location_catalog.prices) {
        if (r.currency_code === locs.currency_code) p[key(r.variant_id, r.province)] = String(r.amount)
      }
      const a: AvailDraft = {}
      for (const r of cat.location_catalog.availability) a[key(r.variant_id, r.province)] = r.is_available
      setPrices(p)
      setAvail(a)
      setLoaded({ prices: p, avail: a })
    } catch (e: any) {
      setError(e?.message ?? "Could not load location settings")
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  // Effective availability: variant override, else product, else sold.
  const isSold = (variantId: string | null, province: string) =>
    avail[key(variantId, province)] ??
    (variantId ? avail[key(null, province)] : undefined) ??
    true

  const toggleSold = (variantId: string | null, province: string, sold: boolean) => {
    setAvail((prev) => {
      const next = { ...prev }
      if (variantId === null) {
        next[key(null, province)] = sold
        // Variants that only followed the product keep following it.
        for (const v of variants) {
          if (next[key(v.id!, province)] === sold) delete next[key(v.id!, province)]
        }
      } else {
        const inherited = next[key(null, province)] ?? true
        if (sold === inherited) delete next[key(variantId, province)]
        else next[key(variantId, province)] = sold
      }
      return next
    })
  }

  const dirty = useMemo(
    () =>
      !!loaded &&
      (JSON.stringify(loaded.prices) !== JSON.stringify(prices) ||
        JSON.stringify(loaded.avail) !== JSON.stringify(avail)),
    [loaded, prices, avail]
  )

  const save = async () => {
    const priceRows: PriceRow[] = []
    for (const [k, raw] of Object.entries(prices)) {
      if (raw.trim() === "") continue
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount < 0) {
        toast.error("Prices must be a number of zero or more.")
        return
      }
      const [variantId, province] = k.split("|")
      priceRows.push({ variant_id: variantId || null, province, currency_code: currency, amount })
    }
    const availRows: AvailRow[] = Object.entries(avail).map(([k, is_available]) => {
      const [variantId, province] = k.split("|")
      return { variant_id: variantId || null, province, is_available }
    })

    setSaving(true)
    try {
      await fetchAdmin(`/admin/products/${product.id}/location-catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices: priceRows, availability: availRows }),
      })
      toast.success("Location prices and availability saved")
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save")
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <Container className="px-6 py-4">
        <Heading level="h2">Location prices &amp; availability</Heading>
        <Text size="small" className="text-ui-fg-error mt-2">{error}</Text>
      </Container>
    )
  }
  if (!loaded) return null

  const rows: { id: string | null; label: string }[] = [
    { id: null, label: variants.length > 1 ? "All variants" : "This product" },
    ...(variants.length > 1
      ? variants.map((v) => ({ id: v.id!, label: v.title || v.sku || v.id! }))
      : []),
  ]

  const placeholderFor = (variantId: string | null, province: string) => {
    if (variantId) {
      const productPrice = prices[key(null, province)]
      if (productPrice?.trim()) return `${formatAmount(Number(productPrice), currency)} (product)`
      const n = nationalPrice(variantId)
      return n === null ? "National price" : `${formatAmount(n, currency)} (national)`
    }
    const only = variants.length === 1 ? nationalPrice(variants[0].id!) : null
    return only === null ? "National price" : `${formatAmount(only, currency)} (national)`
  }

  return (
    <Container className="p-0 divide-y">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Location prices &amp; availability</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Leave a price blank to inherit it. A variant follows the product
            row unless you set its own. Unticked items stay listed but show
            “Not available in &lt;state&gt;” and can’t be bought there.
          </Text>
        </div>
        <Button size="small" onClick={save} isLoading={saving} disabled={!dirty}>
          Save
        </Button>
      </div>

      {!locations.length ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          No locations found. States come from the shops and web locations.
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{currency.toUpperCase()}</Table.HeaderCell>
                {locations.map((l) => (
                  <Table.HeaderCell key={l.province} title={l.channels.map((c) => c.name).join(", ")}>
                    {l.name}
                  </Table.HeaderCell>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id ?? "product"}>
                  <Table.Cell className={r.id ? "pl-8" : "font-medium"}>{r.label}</Table.Cell>
                  {locations.map((l) => {
                    const k = key(r.id, l.province)
                    const sold = isSold(r.id, l.province)
                    const overridden = r.id !== null && k in avail
                    return (
                      <Table.Cell key={l.province} className="min-w-[180px] py-2">
                        <div className="flex flex-col gap-1">
                          <Input
                            size="small"
                            type="number"
                            min={0}
                            value={prices[k] ?? ""}
                            placeholder={placeholderFor(r.id, l.province)}
                            onChange={(e) =>
                              setPrices((prev) => {
                                const next = { ...prev }
                                if (e.target.value === "") delete next[k]
                                else next[k] = e.target.value
                                return next
                              })
                            }
                          />
                          <label className="flex items-center gap-2 text-ui-fg-subtle txt-compact-small">
                            <Checkbox
                              checked={sold}
                              onCheckedChange={(c) => toggleSold(r.id, l.province, c === true)}
                            />
                            {sold ? "Sold here" : `Not available in ${l.name}`}
                            {overridden && <span className="text-ui-fg-muted">(own setting)</span>}
                          </label>
                        </div>
                      </Table.Cell>
                    )
                  })}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      {unmapped.length > 0 && (
        <Text size="small" className="px-6 py-3 text-ui-fg-subtle">
          Not priced by state: {unmapped.map((c) => `${c.name} (state “${c.state ?? "blank"}”)`).join(", ")}.
          Fix the state on the Shops page to include them.
        </Text>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default LocationCatalogWidget
