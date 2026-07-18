import { Module } from "@medusajs/framework/utils"
import CeedmartTaxModuleService from "./service"

export const CEEDMART_TAX_MODULE = "ceedmart_tax"

export default Module(CEEDMART_TAX_MODULE, {
  service: CeedmartTaxModuleService,
})
