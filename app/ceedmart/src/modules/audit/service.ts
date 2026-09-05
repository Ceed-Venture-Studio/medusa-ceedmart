import { MedusaService } from "@medusajs/framework/utils"
import AuditEvent from "./models/audit-event"

export default class AuditModuleService extends MedusaService({
  AuditEvent,
}) {}
