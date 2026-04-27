import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ManualPaymentProvider } from "./manual-base"

export class BankTransferPaymentProvider extends ManualPaymentProvider {
  static identifier = "bank-transfer"
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [BankTransferPaymentProvider],
})
