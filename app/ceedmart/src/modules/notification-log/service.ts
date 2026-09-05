import { MedusaService } from "@medusajs/framework/utils"
import NotificationLog from "./models/notification-log"

export default class NotificationLogModuleService extends MedusaService({
  NotificationLog,
}) {}
