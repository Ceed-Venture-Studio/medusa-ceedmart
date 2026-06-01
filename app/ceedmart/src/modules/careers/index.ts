import { Module } from "@medusajs/framework/utils"
import CareersModuleService from "./service"

export const CAREERS_MODULE = "careers"

export default Module(CAREERS_MODULE, {
  service: CareersModuleService,
})
