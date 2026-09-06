import { Badge, Input, Label, Text, clx } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { fetchAdmin } from "../lib/client"

// Search-as-you-type product and variant picker.
//
// Replaces the raw `variant_01H…` text inputs the pre-order and auction
// forms started with. Nobody knows a variant id by heart, and pasting one
// from another tab is how an offer ends up attached to the wrong item —
// silently, because an id that doesn't resolve just produces an offer for
// a listing nobody can find.
//
// ── The product/variant choice ──────────────────────────────────────────
// An offer targets EITHER a whole product or one variant. Whole-product is
// the common case; per-variant exists because a laptop may have one
// imported configuration while the rest sit on the shelf. So the variant
// step is optional and defaults to "every variant".

type Variant = { id: string; title: string; sku: string | null }
type Product = {
  id: string
  title: string
  thumbnail: string | null
  status: string
  variants: Variant[]
}

export type ProductSelection = {
  productId: string | null
  variantId: string | null
  label: string
}

type Props = {
  value: ProductSelection
  onChange: (selection: ProductSelection) => void
  /** Hide the variant step for flows that always sell a specific unit. */
  requireVariant?: boolean
  helpText?: string
}

const ProductPicker = ({
  value,
  onChange,
  requireVariant = false,
  helpText,
}: Props) => {
  const [term, setTerm] = useState("")
  const [results, setResults] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const res = await fetchAdmin<{ products: Product[] }>(
        `/admin/products?q=${encodeURIComponent(q)}&limit=8&fields=id,title,thumbnail,status,*variants`
      )
      setResults(res.products ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounced so typing a product name doesn't fire a request per keystroke.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => search(term), 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [term, search])

  const pickProduct = (product: Product) => {
    setSelected(product)
    setOpen(false)
    setTerm("")
    setResults([])

    // A single-variant product has no meaningful variant choice, so make it
    // for them rather than asking a question with one answer.
    const only = product.variants?.length === 1 ? product.variants[0] : null
    onChange({
      productId: only ? null : product.id,
      variantId: only ? only.id : null,
      label: only ? `${product.title} · ${only.title}` : product.title,
    })
  }

  const pickVariant = (variant: Variant | null) => {
    if (!selected) return
    onChange({
      productId: variant ? null : selected.id,
      variantId: variant ? variant.id : null,
      label: variant
        ? `${selected.title} · ${variant.title}`
        : `${selected.title} (all variants)`,
    })
  }

  const clear = () => {
    setSelected(null)
    setTerm("")
    setResults([])
    onChange({ productId: null, variantId: null, label: "" })
  }

  return (
    <div className="flex flex-col gap-2">
      <Label size="small">Product</Label>

      {value.label ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {selected?.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.thumbnail}
                alt=""
                className="h-8 w-8 rounded object-cover shrink-0"
              />
            )}
            <Text size="small" className="truncate">
              {value.label}
            </Text>
          </div>
          <button
            type="button"
            onClick={clear}
            className="txt-small text-ui-fg-interactive underline shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={term}
            onChange={(e) => {
              setTerm(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search your catalogue by name…"
          />

          {open && (term.trim() || searching) && (
            <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout">
              {searching ? (
                <div className="px-3 py-2">
                  <Text size="small" className="text-ui-fg-muted">
                    Searching…
                  </Text>
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 flex flex-col gap-1">
                  <Text size="small" className="text-ui-fg-muted">
                    No product matches “{term}”.
                  </Text>
                  <Text size="small" className="text-ui-fg-muted">
                    Create the product first — an offer prices an existing
                    listing, it doesn&apos;t create one.
                  </Text>
                </div>
              ) : (
                results.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => pickProduct(product)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ui-bg-base-hover"
                  >
                    {product.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.thumbnail}
                        alt=""
                        className="h-8 w-8 rounded object-cover shrink-0"
                      />
                    ) : (
                      <span className="h-8 w-8 rounded bg-ui-bg-subtle shrink-0" />
                    )}
                    <span className="flex flex-col min-w-0">
                      <Text size="small" className="truncate">
                        {product.title}
                      </Text>
                      <Text size="small" className="text-ui-fg-muted">
                        {product.variants?.length ?? 0} variant
                        {product.variants?.length === 1 ? "" : "s"}
                        {product.status !== "published" && ` · ${product.status}`}
                      </Text>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Variant step — only when the chosen product actually has a choice. */}
      {selected && (selected.variants?.length ?? 0) > 1 && (
        <div className="flex flex-col gap-1 mt-1">
          <Text size="small" className="text-ui-fg-muted">
            Which variant?
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {!requireVariant && (
              <button
                type="button"
                onClick={() => pickVariant(null)}
                className={clx(
                  "rounded-full border px-2.5 py-1 txt-small",
                  value.productId === selected.id
                    ? "border-ui-fg-interactive bg-ui-bg-highlight"
                    : "border-ui-border-base hover:border-ui-fg-interactive"
                )}
              >
                All variants
              </button>
            )}
            {selected.variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => pickVariant(variant)}
                className={clx(
                  "rounded-full border px-2.5 py-1 txt-small",
                  value.variantId === variant.id
                    ? "border-ui-fg-interactive bg-ui-bg-highlight"
                    : "border-ui-border-base hover:border-ui-fg-interactive"
                )}
              >
                {variant.title}
                {variant.sku && (
                  <span className="text-ui-fg-muted"> · {variant.sku}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {helpText && (
        <Text size="small" className="text-ui-fg-muted">
          {helpText}
        </Text>
      )}

      {value.variantId && (
        <Badge size="2xsmall" className="self-start">
          One variant only
        </Badge>
      )}
    </div>
  )
}

export default ProductPicker
