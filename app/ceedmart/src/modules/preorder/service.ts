import { MedusaService } from "@medusajs/framework/utils"
import SourceSupplier from "./models/source-supplier"
import PreorderOffer from "./models/preorder-offer"
import PreorderOrder from "./models/preorder-order"
import PreorderMilestone from "./models/preorder-milestone"
import CustomerApproval from "./models/customer-approval"

export default class PreorderModuleService extends MedusaService({
  SourceSupplier,
  PreorderOffer,
  PreorderOrder,
  PreorderMilestone,
  CustomerApproval,
}) {}
