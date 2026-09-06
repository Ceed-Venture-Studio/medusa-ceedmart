// Attribute schemas per component slot (BRD §7.3, §7.4).
//
// ── What a schema is for ────────────────────────────────────────────────
// `ComponentOption.attributes` is JSON, which is right — a CPU and a
// monitor have nothing in common. But free-form JSON means the admin form
// has nothing to draw and a CSV import has nothing to check, so a
// mistyped socket becomes a part that silently fits nothing.
//
// The schema fixes that in three places at once:
//   • the admin form renders a field per definition
//   • a CSV import validates and coerces against it
//   • the compatibility rules reference these exact keys, so the schema is
//     the contract between the catalogue and the engine
//
// ── Extending to other products ─────────────────────────────────────────
// Nothing below is special-cased. A new build type — a CCTV kit, a solar
// system — is a BuildType row plus categories carrying their own schemas.
// The engine never learns what a "desktop" is.

export type FieldType = "text" | "number" | "boolean" | "enum" | "list"

export type AttributeField = {
  key: string
  label: string
  type: FieldType
  /** Rendered after the input and appended in CSV headers, e.g. "mm", "W". */
  unit?: string
  required?: boolean
  /** For type "enum" — the permitted values. */
  options?: string[]
  help?: string
  /** True when a compatibility rule reads this key. Surfaced in the admin
   *  so nobody deletes a field the engine depends on. */
  usedByRules?: boolean
}

export type CategorySchema = {
  code: string
  buildTypes: string[]
  fields: AttributeField[]
}

const socket = (help: string): AttributeField => ({
  key: "socket",
  label: "Socket",
  type: "text",
  required: true,
  usedByRules: true,
  help,
})

// ── Desktop PC ──────────────────────────────────────────────────────────

export const CATEGORY_SCHEMAS: CategorySchema[] = [
  {
    code: "cpu",
    buildTypes: ["desktop"],
    fields: [
      socket("Must match the motherboard exactly — AM5, LGA1700."),
      { key: "cores", label: "Cores", type: "number" },
      { key: "threads", label: "Threads", type: "number" },
      { key: "base_clock_ghz", label: "Base clock", type: "number", unit: "GHz" },
      { key: "boost_clock_ghz", label: "Boost clock", type: "number", unit: "GHz" },
      { key: "tdp", label: "TDP", type: "number", unit: "W", usedByRules: true },
      { key: "integrated_graphics", label: "Has integrated graphics", type: "boolean" },
      {
        key: "max_balanced_gpu_tier",
        label: "Balanced up to GPU tier",
        type: "number",
        usedByRules: true,
        help: "Highest GPU tier this chip can keep up with. Drives the 'card stronger than the processor' warning.",
      },
    ],
  },
  {
    code: "motherboard",
    buildTypes: ["desktop"],
    fields: [
      socket("Must match the processor exactly."),
      { key: "chipset", label: "Chipset", type: "text" },
      {
        key: "form_factor",
        label: "Form factor",
        type: "enum",
        options: ["Mini-ITX", "mATX", "ATX", "E-ATX"],
        required: true,
        usedByRules: true,
      },
      {
        key: "supported_memory_types",
        label: "Memory types supported",
        type: "list",
        required: true,
        usedByRules: true,
        help: "Comma-separated, e.g. DDR5",
      },
      { key: "memory_slots", label: "Memory slots", type: "number", required: true, usedByRules: true },
      { key: "max_memory_gb", label: "Max memory", type: "number", unit: "GB", usedByRules: true },
      { key: "max_memory_speed_mhz", label: "Max memory speed", type: "number", unit: "MHz", usedByRules: true },
      {
        key: "supported_storage_interfaces",
        label: "Storage interfaces",
        type: "list",
        usedByRules: true,
        help: "Comma-separated, e.g. NVMe, SATA",
      },
      { key: "m2_slots", label: "M.2 slots", type: "number", usedByRules: true },
      { key: "has_tpm", label: "Has TPM", type: "boolean", usedByRules: true },
    ],
  },
  {
    code: "memory",
    buildTypes: ["desktop"],
    fields: [
      {
        key: "memory_type",
        label: "Memory type",
        type: "enum",
        options: ["DDR4", "DDR5"],
        required: true,
        usedByRules: true,
      },
      { key: "capacity_gb", label: "Capacity per stick", type: "number", unit: "GB", required: true, usedByRules: true },
      { key: "sticks", label: "Sticks in this kit", type: "number", required: true, usedByRules: true },
      { key: "speed_mhz", label: "Speed", type: "number", unit: "MHz", usedByRules: true },
      { key: "cas_latency", label: "CAS latency", type: "number" },
    ],
  },
  {
    code: "gpu",
    buildTypes: ["desktop"],
    fields: [
      { key: "chipset", label: "GPU chipset", type: "text" },
      { key: "vram_gb", label: "VRAM", type: "number", unit: "GB" },
      { key: "length_mm", label: "Length", type: "number", unit: "mm", required: true, usedByRules: true },
      { key: "recommended_psu_watts", label: "Recommended PSU", type: "number", unit: "W", required: true, usedByRules: true },
      { key: "tier", label: "Performance tier", type: "number", usedByRules: true, help: "Used for the CPU/GPU balance warning." },
      { key: "outputs", label: "Display outputs", type: "list", help: "Comma-separated, e.g. HDMI 2.1, DisplayPort 1.4" },
    ],
  },
  {
    code: "storage",
    buildTypes: ["desktop", "laptop"],
    fields: [
      {
        key: "interface",
        label: "Interface",
        type: "enum",
        options: ["NVMe", "SATA", "SAS"],
        required: true,
        usedByRules: true,
      },
      { key: "capacity_gb", label: "Capacity", type: "number", unit: "GB", required: true },
      { key: "uses_m2_slot", label: "Uses an M.2 slot", type: "number", usedByRules: true, help: "1 if it occupies an M.2 slot, 0 otherwise." },
      { key: "read_mbs", label: "Sequential read", type: "number", unit: "MB/s" },
      { key: "form_factor", label: "Form factor", type: "text", help: "2280, 2.5in" },
    ],
  },
  {
    code: "psu",
    buildTypes: ["desktop"],
    fields: [
      { key: "wattage", label: "Wattage", type: "number", unit: "W", required: true, usedByRules: true },
      { key: "efficiency", label: "Efficiency rating", type: "enum", options: ["80+", "Bronze", "Silver", "Gold", "Platinum", "Titanium"] },
      { key: "modular", label: "Modular", type: "enum", options: ["No", "Semi", "Full"] },
      { key: "length_mm", label: "Length", type: "number", unit: "mm" },
    ],
  },
  {
    code: "case",
    buildTypes: ["desktop"],
    fields: [
      {
        key: "supported_form_factors",
        label: "Board sizes it fits",
        type: "list",
        required: true,
        usedByRules: true,
        help: "Comma-separated, e.g. ATX, mATX, Mini-ITX",
      },
      { key: "max_gpu_length_mm", label: "Max GPU length", type: "number", unit: "mm", required: true, usedByRules: true },
      { key: "max_cooler_height_mm", label: "Max cooler height", type: "number", unit: "mm", required: true, usedByRules: true },
      { key: "included_fans", label: "Fans included", type: "number" },
    ],
  },
  {
    code: "cpu_cooler",
    buildTypes: ["desktop"],
    fields: [
      { key: "sockets", label: "Sockets supported", type: "list", required: true, usedByRules: true, help: "Comma-separated, e.g. AM5, LGA1700" },
      { key: "height_mm", label: "Height", type: "number", unit: "mm", required: true, usedByRules: true },
      { key: "type", label: "Type", type: "enum", options: ["Air", "AIO liquid"] },
      { key: "tdp_rating", label: "Rated for TDP", type: "number", unit: "W" },
    ],
  },
  {
    code: "case_cooling",
    buildTypes: ["desktop"],
    fields: [
      { key: "size_mm", label: "Fan size", type: "number", unit: "mm" },
      { key: "airflow_cfm", label: "Airflow", type: "number", unit: "CFM" },
      { key: "noise_dba", label: "Noise", type: "number", unit: "dBA" },
    ],
  },
  {
    code: "operating_system",
    buildTypes: ["desktop", "laptop"],
    fields: [
      { key: "family", label: "Family", type: "enum", options: ["Windows", "Linux", "None"] },
      { key: "edition", label: "Edition", type: "text" },
      { key: "requires_tpm", label: "Requires TPM", type: "boolean", usedByRules: true },
      { key: "licence_type", label: "Licence", type: "enum", options: ["OEM", "Retail", "Volume", "Free"] },
    ],
  },

  // ── Laptop ────────────────────────────────────────────────────────────
  //
  // §7.4 — options are driven by actual purchasable variants, and the
  // interface must not imply a soldered component can be changed. That is
  // what `is_fixed` on the option is for; the schema just describes it.
  {
    code: "laptop_model",
    buildTypes: ["laptop"],
    fields: [
      { key: "brand", label: "Brand", type: "text", required: true },
      { key: "model_family", label: "Model family", type: "text", required: true },
      { key: "screen_size_in", label: "Screen size", type: "number", unit: "in" },
      { key: "weight_kg", label: "Weight", type: "number", unit: "kg" },
      { key: "chassis", label: "Chassis material", type: "text" },
    ],
  },
  {
    code: "laptop_cpu",
    buildTypes: ["laptop"],
    fields: [
      { key: "model", label: "Processor", type: "text", required: true },
      { key: "cores", label: "Cores", type: "number" },
      { key: "boost_clock_ghz", label: "Boost clock", type: "number", unit: "GHz" },
      { key: "integrated_graphics", label: "Integrated graphics", type: "text" },
    ],
  },
  {
    code: "laptop_memory",
    buildTypes: ["laptop"],
    fields: [
      { key: "capacity_gb", label: "Capacity", type: "number", unit: "GB", required: true },
      { key: "memory_type", label: "Type", type: "enum", options: ["DDR4", "DDR5", "LPDDR5"] },
      {
        key: "soldered",
        label: "Soldered to the board",
        type: "boolean",
        help: "If yes, mark the option Fixed so the builder shows it without offering a change (§7.4).",
      },
      { key: "upgradeable_to_gb", label: "Upgradeable to", type: "number", unit: "GB" },
    ],
  },
  {
    code: "laptop_display",
    buildTypes: ["laptop"],
    fields: [
      { key: "resolution", label: "Resolution", type: "text", required: true, help: "1920x1080" },
      { key: "refresh_hz", label: "Refresh rate", type: "number", unit: "Hz" },
      { key: "panel", label: "Panel type", type: "enum", options: ["IPS", "OLED", "TN", "VA"] },
      { key: "brightness_nits", label: "Brightness", type: "number", unit: "nits" },
      { key: "touch", label: "Touchscreen", type: "boolean" },
    ],
  },
  {
    code: "laptop_keyboard",
    buildTypes: ["laptop"],
    fields: [
      { key: "layout", label: "Layout", type: "enum", options: ["UK", "US", "AZERTY", "QWERTZ"], required: true },
      { key: "backlit", label: "Backlit", type: "boolean" },
      { key: "numpad", label: "Numeric keypad", type: "boolean" },
    ],
  },
  {
    code: "laptop_battery",
    buildTypes: ["laptop"],
    fields: [
      { key: "capacity_wh", label: "Capacity", type: "number", unit: "Wh" },
      { key: "charger_watts", label: "Charger", type: "number", unit: "W" },
      { key: "charger_type", label: "Charger connector", type: "enum", options: ["USB-C", "Barrel", "Proprietary"] },
    ],
  },

  // ── Shared ────────────────────────────────────────────────────────────
  {
    code: "monitor",
    buildTypes: ["desktop", "laptop"],
    fields: [
      { key: "size_in", label: "Size", type: "number", unit: "in", required: true },
      { key: "resolution", label: "Resolution", type: "text", required: true },
      { key: "refresh_hz", label: "Refresh rate", type: "number", unit: "Hz" },
      { key: "panel", label: "Panel type", type: "enum", options: ["IPS", "OLED", "TN", "VA"] },
      { key: "inputs", label: "Inputs", type: "list", help: "Comma-separated" },
    ],
  },
  {
    code: "peripherals",
    buildTypes: ["desktop", "laptop"],
    fields: [
      { key: "kind", label: "Kind", type: "enum", options: ["Keyboard", "Mouse", "Combo", "Headset", "Webcam"] },
      { key: "connection", label: "Connection", type: "enum", options: ["Wired", "Wireless", "Bluetooth"] },
    ],
  },
  {
    code: "networking",
    buildTypes: ["desktop", "laptop"],
    fields: [
      { key: "kind", label: "Kind", type: "enum", options: ["Wi-Fi card", "Ethernet card", "USB adapter"] },
      { key: "standard", label: "Standard", type: "text", help: "Wi-Fi 6E, 2.5GbE" },
    ],
  },
  {
    code: "services",
    buildTypes: ["desktop", "laptop"],
    fields: [
      {
        key: "kind",
        label: "Service",
        type: "enum",
        options: ["Assembly", "Software setup", "Data transfer", "Extended testing", "Extended warranty"],
        required: true,
      },
      { key: "duration_months", label: "Duration", type: "number", unit: "months" },
    ],
  },
]

export const schemaFor = (code: string): AttributeField[] =>
  CATEGORY_SCHEMAS.find((c) => c.code === code)?.fields ?? []

/** Every attribute key the compatibility rules actually read, so the admin
 *  can warn before someone removes one. */
export const ruleCriticalKeys = (code: string): string[] =>
  schemaFor(code)
    .filter((f) => f.usedByRules)
    .map((f) => f.key)
