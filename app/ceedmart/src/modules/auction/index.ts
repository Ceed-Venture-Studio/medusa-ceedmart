import { Module } from "@medusajs/framework/utils"
import AuctionModuleService from "./service"

export const AUCTION_MODULE = "auction"

export default Module(AUCTION_MODULE, {
  service: AuctionModuleService,
})
