import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { BUILD_CATALOG_MODULE } from "../../../../../../modules/build-catalog"
import { schemaFor } from "../../../../../../lib/build-catalog/schema"
import { csvExampleRow, csvHeader } from "../../../../../../lib/build-catalog/attributes"
import { toCsv } from "../../../../../../lib/build-catalog/csv"

// Download a CSV template for one slot.
//
// Generated from the slot's own schema rather than kept as a static file,
// so a template can never drift from what the importer accepts. The header
// carries units ("wattage (W)") because a sheet filled in watts and read as
// kilowatts is a silent, expensive mistake.

export const GET = async (
  req: AuthenticatedMedusaRequest,
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

  const fields = category.attribute_schema ?? schemaFor(category.code)
  const csv = toCsv(csvHeader(fields), [csvExampleRow(fields)])

  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ceedmart-${category.code}-template.csv"`
  )
  res.send(csv)
}
