import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ManualPaymentProvider } from "./manual-base"

export class CardPaymentProvider extends ManualPaymentProvider {
  static identifier = "card"
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [CardPaymentProvider],
})
