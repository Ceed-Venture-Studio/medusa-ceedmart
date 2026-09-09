import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PulsePayService from "./services/pulse-pay"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PulsePayService],
})

export {
  fetchPaymentOptions,
  fetchPaymentStatus,
  mintCustomerToken,
} from "./lib/payment-options"
export type { PulsePaymentOption, PulseTokenConfig } from "./lib/payment-options"
