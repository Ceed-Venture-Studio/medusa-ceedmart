import { Module } from "@medusajs/framework/utils"
import LocationCatalogModuleService from "./service"

export const LOCATION_CATALOG_MODULE = "location_catalog"

export default Module(LOCATION_CATALOG_MODULE, {
  service: LocationCatalogModuleService,
})
