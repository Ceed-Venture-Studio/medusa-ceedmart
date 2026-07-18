import { MedusaService } from "@medusajs/framework/utils"
import TaxOverride from "./models/tax-override"

export default class CeedmartTaxModuleService extends MedusaService({
  TaxOverride,
}) {}
