import { MedusaService } from "@medusajs/framework/utils"
import Partner from "./models/partner"

export default class PartnerModuleService extends MedusaService({
  Partner,
}) {}
