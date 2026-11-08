import { z } from "@medusajs/framework/zod"

const province = z.string().regex(/^ng-[a-z]{2}$/, "Expected a state code like ng-la")

export const AdminSetLocationCatalog = z.object({
  prices: z
    .array(
      z.object({
        variant_id: z.string().nullish(),
        province,
        currency_code: z.string().length(3),
        amount: z.number().nonnegative(),
      })
    )
    .default([]),
  availability: z
    .array(
      z.object({
        variant_id: z.string().nullish(),
        province,
        is_available: z.boolean(),
      })
    )
    .default([]),
})

export type AdminSetLocationCatalogType = z.infer<typeof AdminSetLocationCatalog>
