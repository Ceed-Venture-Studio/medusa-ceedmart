import { Module } from "@medusajs/framework/utils"
import StockTransferModuleService from "./service"

export const STOCK_TRANSFER_MODULE = "stock_transfer"

export default Module(STOCK_TRANSFER_MODULE, {
  service: StockTransferModuleService,
})
