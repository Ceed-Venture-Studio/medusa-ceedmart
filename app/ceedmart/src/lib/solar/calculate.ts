// Solar load math. Pure functions — no I/O — so the same code can be reused
// in the storefront if we ever want client-side preview.

export type AppliancePeriod = "day" | "night" | "both"

export type ApplianceInput = {
  name: string
  qty: number
  watts: number
  hours_per_day: number
  period: AppliancePeriod
  critical?: boolean
  // Optional surge multiplier (e.g. AC/freezer/pump). Defaults inferred from
  // name match, but callers can override.
  surge_factor?: number
}

export type LoadProfile = {
  appliances: ApplianceInput[]
  total_load_w: number       // sum of qty*watts (connected load)
  peak_load_w: number        // total_load_w with surge factors applied to relevant appliances
  daily_kwh: number          // sum across all appliances
  day_kwh: number
  night_kwh: number
  has_heavy_motors: boolean  // any appliance has surge_factor > 1.5
  margin_pct: number         // recommended safety margin (25 normal, 50 if heavy motors)
}

const HEAVY_MOTOR_PATTERNS = [
  /\bac\b/i,
  /air[ -]?con/i,
  /freezer/i,
  /pump/i,
  /motor/i,
  /compressor/i,
  /well/i,
  /borehole/i,
]

function inferSurge(name: string, explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit
  return HEAVY_MOTOR_PATTERNS.some((p) => p.test(name)) ? 3 : 1
}

export function calculateLoad(appliances: ApplianceInput[]): LoadProfile {
  let total = 0
  let peak = 0
  let dailyKwh = 0
  let dayKwh = 0
  let nightKwh = 0
  let heavy = false

  for (const a of appliances) {
    const qty = Math.max(1, Math.floor(a.qty))
    const watts = Math.max(0, a.watts)
    const hours = Math.max(0, a.hours_per_day)
    const w = qty * watts
    const kwh = (w * hours) / 1000

    total += w
    const surge = inferSurge(a.name, a.surge_factor)
    peak += w * surge
    if (surge > 1.5) heavy = true

    dailyKwh += kwh
    if (a.period === "night") nightKwh += kwh
    else if (a.period === "day") dayKwh += kwh
    else {
      // "both" — split evenly. Crude but explicit; storefront can override
      // by sending two rows with explicit periods if they want precision.
      dayKwh += kwh / 2
      nightKwh += kwh / 2
    }
  }

  const margin_pct = heavy ? 50 : 25

  return {
    appliances,
    total_load_w: Math.round(total),
    peak_load_w: Math.round(peak),
    daily_kwh: round1(dailyKwh),
    day_kwh: round1(dayKwh),
    night_kwh: round1(nightKwh),
    has_heavy_motors: heavy,
    margin_pct,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
