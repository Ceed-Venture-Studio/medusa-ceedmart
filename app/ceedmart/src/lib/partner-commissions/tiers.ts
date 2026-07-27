// Program tiers from the Ceedmart Incentive spec.
//
// Each row is the code, human label, and the rate used when accruing
// per-order commission. The SHOPPER rate is the *effective* percentage
// derived from the spec's points formula (1 point per ₦100, 1 point =
// ₦2 → 2%). This lets the MVP treat all four tiers uniformly as
// commission accrual while the points-native shopper flow is out of
// scope for now.

export type PartnerTierCode =
  | "SHOPPER"
  | "EMPLOYEE_SALES"
  | "RESELLER"
  | "PARTNER"

export type PartnerTier = {
  code: PartnerTierCode
  label: string
  rate: number  // decimal e.g. 0.07
  description: string
}

export const PARTNER_TIERS: PartnerTier[] = [
  {
    code: "SHOPPER",
    label: "Shopper (Customer)",
    rate: 0.02,
    description: "Customer/household. 2% effective (1 point per ₦100, 1 point = ₦2).",
  },
  {
    code: "EMPLOYEE_SALES",
    label: "Employee Sales",
    rate: 0.01,
    description: "Sales employees. 1% of verified monthly sales.",
  },
  {
    code: "RESELLER",
    label: "Reseller",
    rate: 0.04,
    description: "External individual sellers. 4% verified-sales commission.",
  },
  {
    code: "PARTNER",
    label: "Partner",
    rate: 0.07,
    description: "High-volume resellers/businesses. 7% verified-sales commission.",
  },
]

const byCode = new Map<PartnerTierCode, PartnerTier>(
  PARTNER_TIERS.map((t) => [t.code, t])
)

export function getTier(code: string | null | undefined): PartnerTier | undefined {
  if (!code) return undefined
  return byCode.get(code as PartnerTierCode)
}

export function isValidTier(code: string): code is PartnerTierCode {
  return byCode.has(code as PartnerTierCode)
}

export function rateForTier(code: string | null | undefined): number {
  return getTier(code)?.rate ?? 0.02
}

export const DEFAULT_TIER: PartnerTierCode = "SHOPPER"
