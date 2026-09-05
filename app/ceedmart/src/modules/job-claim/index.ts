import { Module } from "@medusajs/framework/utils"
import JobClaimModuleService from "./service"

export const JOB_CLAIM_MODULE = "job_claim"

export default Module(JOB_CLAIM_MODULE, {
  service: JobClaimModuleService,
})
