import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PulseSmsNotificationService } from "./services/pulse-sms"

const services = [PulseSmsNotificationService]

export default ModuleProvider(Modules.NOTIFICATION, {
  services,
})
