import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PulsePayService from "./services/pulse-pay"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PulsePayService],
})
