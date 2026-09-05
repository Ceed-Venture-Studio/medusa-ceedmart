import { Module } from "@medusajs/framework/utils"
import AuditModuleService from "./service"

export const AUDIT_MODULE = "audit"

export default Module(AUDIT_MODULE, {
  service: AuditModuleService,
})
