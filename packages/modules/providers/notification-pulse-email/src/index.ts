import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PulseEmailNotificationService } from "./services/pulse-email"

const services = [PulseEmailNotificationService]

export default ModuleProvider(Modules.NOTIFICATION, {
  services,
})
