import { Module } from "@medusajs/framework/utils"
import BuildModuleService from "./service"

export const BUILD_MODULE = "build"

export default Module(BUILD_MODULE, {
  service: BuildModuleService,
})
