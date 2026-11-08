import { MedusaService } from "@medusajs/framework/utils"
import LocationAvailability from "./models/location-availability"
import LocationPrice from "./models/location-price"

export default class LocationCatalogModuleService extends MedusaService({
  LocationPrice,
  LocationAvailability,
}) {}
