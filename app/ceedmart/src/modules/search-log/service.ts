import { MedusaService } from "@medusajs/framework/utils"
import SearchLog from "./models/search-log"

export default class SearchLogModuleService extends MedusaService({
  SearchLog,
}) {}
