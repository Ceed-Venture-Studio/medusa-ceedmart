import { Module } from "@medusajs/framework/utils"
import TermsModuleService from "./service"

export const TERMS_MODULE = "terms"

// Slugs referenced from code. Kept here so a typo is a compile error at the
// call site rather than a silently missing terms document at checkout.
export const TERMS_SLUGS = {
  PREORDER: "preorder",
  CUSTOM_BUILD: "custom_build",
  AUCTION: "auction",
} as const

export type TermsSlug = (typeof TERMS_SLUGS)[keyof typeof TERMS_SLUGS]

export default Module(TERMS_MODULE, {
  service: TermsModuleService,
})
