// Static "what can this system power" library. Used to translate a system's
// daily-kWh budget into a human-readable list of appliance counts so the
// storefront can show "powers 20 lights, 4 fans, 1 fridge".
//
// Order matters: items earlier in the list are awarded budget first, so the
// list reflects typical priorities (lights/fans before AC).

export type AppliancePreset = {
  key: string
  label: string
  watts: number
  typical_hours: number       // hours/day at this load
  max_qty: number             // cap so a 10kWh system doesn't claim 200 lights
  category: "essential" | "comfort" | "heavy"
}

export const APPLIANCE_PRESETS: AppliancePreset[] = [
  { key: "lights",     label: "LED Lights",       watts: 10,   typical_hours: 8,  max_qty: 30, category: "essential" },
  { key: "fans",       label: "Standing/Ceiling Fans", watts: 60, typical_hours: 10, max_qty: 6,  category: "essential" },
  { key: "tv",         label: "TV (LED 43\")",     watts: 80,   typical_hours: 6,  max_qty: 3,  category: "essential" },
  { key: "laptops",    label: "Laptops & phones",  watts: 80,   typical_hours: 6,  max_qty: 5,  category: "essential" },
  { key: "fridge",     label: "Fridge",            watts: 250,  typical_hours: 12, max_qty: 1,  category: "comfort" },
  { key: "freezer",    label: "Chest Freezer",     watts: 350,  typical_hours: 12, max_qty: 1,  category: "comfort" },
  { key: "ac_15hp",    label: "1.5HP Inverter AC", watts: 1100, typical_hours: 6,  max_qty: 2,  category: "heavy" },
  { key: "cooker",     label: "Electric Cooker",   watts: 2000, typical_hours: 1,  max_qty: 1,  category: "heavy" },
  { key: "heater",     label: "Water Heater",      watts: 2500, typical_hours: 1,  max_qty: 1,  category: "heavy" },
  { key: "pump",       label: "Water Pump",        watts: 750,  typical_hours: 1,  max_qty: 1,  category: "heavy" },
]

export type CanPowerEntry = { label: string; qty: number }

export function describeCapacity(
  daily_kwh_budget: number,
  inverter_kw: number
): { canPower: CanPowerEntry[]; cannotPower: string[] } {
  let remaining = daily_kwh_budget
  const canPower: CanPowerEntry[] = []
  const cannotPower: string[] = []

  for (const preset of APPLIANCE_PRESETS) {
    const perUnitKwh = (preset.watts * preset.typical_hours) / 1000
    // Heavy motor loads also need inverter headroom — exclude if the inverter
    // can't run them simultaneously with the essentials.
    const inverterCanRun = preset.watts <= inverter_kw * 1000 * 0.7

    if (!inverterCanRun || perUnitKwh > remaining) {
      if (preset.category !== "essential") cannotPower.push(preset.label)
      continue
    }

    const fitQty = Math.min(preset.max_qty, Math.floor(remaining / perUnitKwh))
    if (fitQty <= 0) continue

    canPower.push({ label: preset.label, qty: fitQty })
    remaining -= fitQty * perUnitKwh
  }

  return { canPower, cannotPower }
}
