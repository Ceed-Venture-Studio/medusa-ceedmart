import { MedusaService } from "@medusajs/framework/utils"
import BuildType from "./models/build-type"
import ComponentCategory from "./models/component-category"
import ComponentOption from "./models/component-option"
import CompatibilityRule from "./models/compatibility-rule"
import BuildConfiguration from "./models/build-configuration"

export default class BuildCatalogModuleService extends MedusaService({
  BuildType,
  ComponentCategory,
  ComponentOption,
  CompatibilityRule,
  BuildConfiguration,
}) {}
