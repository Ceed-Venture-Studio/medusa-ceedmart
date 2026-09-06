import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../../../../../../modules/build-catalog"
import { schemaFor } from "../../../../../../lib/build-catalog/schema"
import { coerceAttributes } from "../../../../../../lib/build-catalog/attributes"

// The parts inside one slot.
//
// Attributes are validated against the category's schema on the way in, so
// a part entered by hand and one imported from a sheet end up identical —
// see lib/build-catalog/attributes for why that matters.

type Body = {
  label: string
  brand?: string
  variant_id?: string
  product_id?: string
  indicative_price?: number
  is_fixed?: boolean
  model_family?: string
  sort_order?: number
  attributes?: Record<string, unknown>
}

const loadCategory = async (req: AuthenticatedMedusaRequest) => {
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
  return { svc, category }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { svc, category } = await loadCategory(req)

  const options = await svc.listComponentOptions(
    { category_id: category.id },
    { order: { sort_order: "ASC" }, take: 500 }
  )

  res.json({
    category: {
      ...category,
      attribute_schema: category.attribute_schema ?? schemaFor(category.code),
    },
    options: (options as any[]).map((o) => ({
      ...o,
      indicative_price:
        o.indicative_price === null ? null : Number(o.indicative_price),
    })),
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { svc, category } = await loadCategory(req)
  const body = req.body || ({} as Body)

  if (!body.label?.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Every part needs a name the customer can read"
    )
  }

  const fields = category.attribute_schema ?? schemaFor(category.code)
  const coerced = coerceAttributes(fields, body.attributes ?? {})

  if (!coerced.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      coerced.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("; ")
    )
  }

  const option = await svc.createComponentOptions({
    category_id: category.id,
    label: body.label.trim(),
    brand: body.brand?.trim() || null,
    variant_id: body.variant_id?.trim() || null,
    product_id: body.product_id?.trim() || null,
    indicative_price:
      body.indicative_price == null ? null : Math.round(Number(body.indicative_price)),
    is_fixed: body.is_fixed === true,
    model_family: body.model_family?.trim() || null,
    sort_order: body.sort_order ?? 0,
    attributes: coerced.attributes,
    is_active: true,
  })

  res.status(201).json({
    option,
    // Warnings are returned rather than swallowed: a part missing a
    // rule-critical attribute is saveable, but the operator should know the
    // engine will skip that check for it.
    warnings: coerced.issues.filter((i) => i.severity === "warning"),
  })
}
