import { model } from "@medusajs/framework/utils"

// A customer-facing terms document — "US Pre-Order Terms", "Auction Terms",
// "Custom Build Terms" (BRD §5.3, §6.6, §8.4).
//
// The document is the stable identity; its wording lives in versions. Legal
// copy on the storefront today is static React under (main)/legal/*, which
// has no version an order can reference. Once terms are versioned, an order
// can point at the exact wording the customer agreed to, and later edits
// never rewrite what was accepted.

const TermsDocument = model
  .define("TermsDocument", {
    id: model.id({ prefix: "terms" }).primaryKey(),
    // Stable slug referenced from code: "preorder", "auction", "custom_build".
    slug: model.text().unique(),
    name: model.text().searchable(),
    description: model.text().nullable(),
  })
  .indexes([{ on: ["slug"] }])

export default TermsDocument
