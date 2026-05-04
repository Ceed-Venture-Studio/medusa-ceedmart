import { Module } from "@medusajs/framework/utils"
import SolarModuleService from "./service"

export const SOLAR_MODULE = "solar"

export default Module(SOLAR_MODULE, {
  service: SolarModuleService,
})
