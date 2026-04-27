import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ManualPaymentProvider } from "./manual-base"

export class OtherPaymentProvider extends ManualPaymentProvider {
  static identifier = "other"
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [OtherPaymentProvider],
})
