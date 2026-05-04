import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOLAR_MODULE } from "../../../../../modules/solar"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params
  const svc: any = req.scope.resolve(SOLAR_MODULE)
  const quote = await svc.retrieveSolarQuote(id).catch(() => null)
  if (!quote) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Quote ${id} not found`)
  }

  let calculation: any = null
  if (quote.calculation_id) {
    calculation = await svc
      .retrieveSolarCalculation(quote.calculation_id)
      .catch(() => null)
  }

  res.json({ quote, calculation })
}
