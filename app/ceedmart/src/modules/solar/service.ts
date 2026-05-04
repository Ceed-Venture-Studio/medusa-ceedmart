import { MedusaService } from "@medusajs/framework/utils"
import SolarCalculation from "./models/solar-calculation"
import SolarQuote from "./models/solar-quote"

export default class SolarModuleService extends MedusaService({
  SolarCalculation,
  SolarQuote,
}) {}
