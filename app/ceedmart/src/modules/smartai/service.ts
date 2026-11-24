import { MedusaService } from "@medusajs/framework/utils"
import ShopperCart from "./models/shopper-cart"

export default class SmartaiModuleService extends MedusaService({
  ShopperCart,
}) {}
