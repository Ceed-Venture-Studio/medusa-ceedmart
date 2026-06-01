import { MedusaService } from "@medusajs/framework/utils"
import Requisition from "./models/requisition"

export default class CareersModuleService extends MedusaService({
  Requisition,
}) {}
