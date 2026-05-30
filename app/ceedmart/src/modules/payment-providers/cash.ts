import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ManualPaymentProvider } from "./manual-base"

export class CashPaymentProvider extends ManualPaymentProvider {
  static identifier = "cash"
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [CashPaymentProvider],
})
