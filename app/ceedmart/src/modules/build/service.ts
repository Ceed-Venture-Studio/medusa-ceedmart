import { MedusaService } from "@medusajs/framework/utils"
import BuildRequest from "./models/build-request"
import BuildQuote from "./models/build-quote"
import BuildQuoteVersion from "./models/build-quote-version"
import BuildOrder from "./models/build-order"
import BuildMilestone from "./models/build-milestone"
import QaCheck from "./models/qa-check"

export default class BuildModuleService extends MedusaService({
  BuildRequest,
  BuildQuote,
  BuildQuoteVersion,
  BuildOrder,
  BuildMilestone,
  QaCheck,
}) {}
