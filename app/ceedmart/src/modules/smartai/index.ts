import { Module } from "@medusajs/framework/utils"
import SmartaiModuleService from "./service"

export const SMARTAI_MODULE = "smartai"

export default Module(SMARTAI_MODULE, {
  service: SmartaiModuleService,
})
