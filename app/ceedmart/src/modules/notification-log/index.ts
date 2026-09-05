import { Module } from "@medusajs/framework/utils"
import NotificationLogModuleService from "./service"

export const NOTIFICATION_LOG_MODULE = "notification_log"

export default Module(NOTIFICATION_LOG_MODULE, {
  service: NotificationLogModuleService,
})
