import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../../../../../../modules/build-catalog"
import {
  schemaFor,
  type AttributeField,
} from "../../../../../../lib/build-catalog/schema"
import {
  coerceAttributes,
  headerToKey,
} from "../../../../../../lib/build-catalog/attributes"
import { parseCsv } from "../../../../../../lib/build-catalog/csv"

// Bulk-import parts into one slot from a supplier sheet (option 3 of the
// spec-population options: manual entry, done at scale).
//
// ── Dry run by default ──────────────────────────────────────────────────
// The response tells you exactly what WOULD happen — how many rows create,
// how many update, which rows fail and why — and writes nothing unless
// `apply` is true. A sheet from a supplier is usually wrong the first time,
// and finding out by importing 200 bad rows and deleting them is not a
// workflow.
//
// ── Rows are independent ────────────────────────────────────────────────
// One bad row does not abort the file. A supplier sheet with three broken
// rows out of two hundred should import a hundred and ninety-seven and
// tell you about the three, not refuse the lot.
//
// Matching is by label within the slot, so re-importing a corrected sheet
// updates rather than duplicates.

type Body = { csv: string; apply?: boolean }

type RowResult = {
  row: number
  label: string
  action: "create" | "update" | "skip"
  errors: string[]
  warnings: string[]
}

const MAX_ROWS = 2000

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const svc: any = req.scope.resolve(BUILD_CATALOG_MODULE)
  const category = await svc
    .retrieveComponentCategory(req.params.id)
    .catch(() => null)

  if (!category) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Component slot ${req.params.id} was not found`
    )
  }

  const text = req.body?.csv
  if (!text?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "No CSV content received")
  }

  const { headers, rows } = parseCsv(text)
  if (!rows.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "That file has a header but no rows"
    )
  }
  if (rows.length > MAX_ROWS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `That file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it.`
    )
  }

  if (!headers.some((h) => headerToKey(h) === "label")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'The sheet needs a "label" column — download the template for this slot.'
    )
  }

  const fields = category.attribute_schema ?? schemaFor(category.code)
  const apply = req.body?.apply === true

  // Existing parts, so a re-import updates rather than duplicates.
  const existing = await svc.listComponentOptions(
    { category_id: category.id },
    { take: 2000 }
  )
  const byLabel = new Map<string, any>(
    (existing as any[]).map((o) => [String(o.label).trim().toLowerCase(), o])
  )

  // Columns the schema does not model, reported once rather than per row.
  const knownKeys = new Set([
    "label", "brand", "variant_id", "product_id",
    "is_fixed", "model_family", "sort_order",
    ...(fields as AttributeField[]).map((f) => f.key),
  ])
  const ignoredColumns = headers
    .map(headerToKey)
    .filter((k) => k && !knownKeys.has(k))

  const results: RowResult[] = []

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    // Re-key by the schema's own names, dropping the "(unit)" annotations.
    const row: Record<string, string> = {}
    for (const [header, value] of Object.entries(raw)) {
      row[headerToKey(header)] = value
    }

    const label = (row.label ?? "").trim()
    const lineNumber = i + 2 // header is line 1

    if (!label) {
      results.push({
        row: lineNumber,
        label: "",
        action: "skip",
        errors: ["Row has no label"],
        warnings: [],
      })
      continue
    }

    const coerced = coerceAttributes(fields, row)
    const errors = coerced.issues
      .filter((x) => x.severity === "error")
      .map((x) => x.message)
    const warnings = coerced.issues
      .filter((x) => x.severity === "warning")
      .map((x) => x.message)

    const match = byLabel.get(label.toLowerCase())
    const action: RowResult["action"] = errors.length
      ? "skip"
      : match
        ? "update"
        : "create"

    results.push({ row: lineNumber, label, action, errors, warnings })

    if (!apply || errors.length) continue

    const payload = {
      category_id: category.id,
      label,
      brand: row.brand?.trim() || null,
      variant_id: row.variant_id?.trim() || null,
      product_id: row.product_id?.trim() || null,
      is_fixed: ["yes", "true", "y", "1"].includes(
        (row.is_fixed ?? "").trim().toLowerCase()
      ),
      model_family: row.model_family?.trim() || null,
      sort_order: Number(row.sort_order) || 0,
      attributes: coerced.attributes,
      is_active: true,
    }

    if (match) await svc.updateComponentOptions({ id: match.id, ...payload })
    else await svc.createComponentOptions(payload)
  }

  const summary = {
    total: results.length,
    create: results.filter((r) => r.action === "create").length,
    update: results.filter((r) => r.action === "update").length,
    skipped: results.filter((r) => r.action === "skip").length,
    with_warnings: results.filter((r) => r.warnings.length).length,
  }

  res.json({
    applied: apply,
    summary,
    ignored_columns: ignoredColumns,
    // Failing rows first — that is what the operator has to act on.
    results: [
      ...results.filter((r) => r.errors.length),
      ...results.filter((r) => !r.errors.length),
    ].slice(0, 200),
  })
}
