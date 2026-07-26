import { MedusaService } from "@medusajs/framework/utils"
import CommissionEntry from "./models/commission-entry"

export default class CommissionEntryModuleService extends MedusaService({
  CommissionEntry,
}) {}
