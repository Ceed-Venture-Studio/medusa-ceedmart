import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CAREERS_MODULE } from "../../../../modules/careers"

// Public single-row endpoint for the storefront detail page. Returns 404 if
// the requisition is missing OR not currently open — closed listings should
// not be addressable from the public site.

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(CAREERS_MODULE)
  const requisition = await svc.retrieveRequisition(id).catch(() => null)

  if (!requisition || requisition.status !== "open") {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Requisition ${id} not found`
    )
  }

  res.json({ requisition })
}
