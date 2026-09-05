import { Module } from "@medusajs/framework/utils"
import BuildCatalogModuleService from "./service"

export const BUILD_CATALOG_MODULE = "build_catalog"

export default Module(BUILD_CATALOG_MODULE, {
  service: BuildCatalogModuleService,
})
