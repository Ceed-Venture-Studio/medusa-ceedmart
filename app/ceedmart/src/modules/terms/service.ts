import { MedusaService } from "@medusajs/framework/utils"
import TermsDocument from "./models/terms-document"
import TermsVersion from "./models/terms-version"
import TermsAcceptance from "./models/terms-acceptance"

export default class TermsModuleService extends MedusaService({
  TermsDocument,
  TermsVersion,
  TermsAcceptance,
}) {}
