import { MedusaService } from "@medusajs/framework/utils"
import ListingPolicy from "./models/listing-policy"

export default class ListingPolicyModuleService extends MedusaService({
  ListingPolicy,
}) {}
