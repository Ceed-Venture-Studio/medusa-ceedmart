import { Module } from "@medusajs/framework/utils"
import ListingPolicyModuleService from "./service"

export const LISTING_POLICY_MODULE = "listing_policy"

export default Module(LISTING_POLICY_MODULE, {
  service: ListingPolicyModuleService,
})
