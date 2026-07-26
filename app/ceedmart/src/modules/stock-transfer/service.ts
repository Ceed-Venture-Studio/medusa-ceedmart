import { MedusaService } from "@medusajs/framework/utils"
import StockTransfer from "./models/stock-transfer"

export default class StockTransferModuleService extends MedusaService({
  StockTransfer,
}) {}
