import { Module } from "@medusajs/framework/utils"
import CommissionEntryModuleService from "./service"

export const COMMISSION_ENTRY_MODULE = "commission_entry"

export default Module(COMMISSION_ENTRY_MODULE, {
  service: CommissionEntryModuleService,
})
