import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOLAR_MODULE } from "../../../../../../modules/solar"

const ALLOWED = new Set(["new", "contacted", "quoted", "won", "lost"])

type Body = { status: string }

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const status = (req.body?.status || "").trim()
  if (!ALLOWED.has(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `status must be one of ${[...ALLOWED].join(", ")}`
    )
  }

  const svc: any = req.scope.resolve(SOLAR_MODULE)
  const updated = await svc.updateSolarQuotes({ id, status })
  res.json({ quote: Array.isArray(updated) ? updated[0] : updated })
}
