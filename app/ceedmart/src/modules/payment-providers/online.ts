import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ManualPaymentProvider } from "./manual-base"

export class OnlinePaymentProvider extends ManualPaymentProvider {
  static identifier = "online"
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [OnlinePaymentProvider],
})
