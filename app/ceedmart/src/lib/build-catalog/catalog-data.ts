// The build catalogue, as data.
//
// ── One definition, two consumers ───────────────────────────────────────
// The seed script and the data migration both read this file, so a local
// database and a freshly migrated production one end up with the same
// catalogue. Anything defined in two places drifts; this session has
// already produced two bugs of exactly that shape.
//
// ── What is required ────────────────────────────────────────────────────
// Only five things: a processor, RAM, an SSD, an operating system, and —
// on a laptop — a screen size. Everything else may be left empty.
//
// A configurator that demands a motherboard, a case, a PSU and a cooler
// before it will accept anything is asking the customer to do the
// specialist's job. Those slots still exist for people who want to fill
// them; they just no longer block the request.
//
// ── Brand filtering ─────────────────────────────────────────────────────
// An option may declare `brands`, meaning it only appears when one of those
// brands is selected. An option with no `brands` key appears for every
// brand. That is how "Apple" narrows the processor list to M-series and the
// form factors to Tower and Studio, without a rule that fires after the
// customer has already chosen wrongly.

export type CatalogCategory = {
  code: string
  label: string
  /**
   * "retired" is how a slot is withdrawn. Categories are loaded with
   * `applies_to in (buildType, "both")`, so a value matching neither hides
   * the slot everywhere without deleting a row that existing build requests
   * still point at.
   */
  applies_to: "desktop" | "laptop" | "both" | "retired"
  is_required: boolean
  sort_order: number
  allows_multiple?: boolean
  max_quantity?: number
  help_text?: string
}

export type CatalogOption = {
  category: string
  label: string
  brand?: string | null
  attributes?: Record<string, unknown>
  sort_order?: number
}

export const BUILD_TYPES = [
  {
    code: "desktop",
    label: "Desktop PC",
    description: "A tower, small-form-factor or thin client built to order.",
    customer_blurb: "Built for your desk, upgradeable later.",
    sort_order: 10,
  },
  {
    code: "laptop",
    label: "Laptop",
    description: "A portable machine configured to order.",
    customer_blurb: "Specced for how you actually work.",
    sort_order: 20,
  },
]

// ─── Slots ────────────────────────────────────────────────────────────────

export const CATEGORIES: CatalogCategory[] = [
  {
    code: "brand",
    label: "Brand",
    applies_to: "both",
    is_required: false,
    sort_order: 5,
    help_text:
      "Pick a brand to narrow the parts to what that manufacturer actually offers. Leave it blank to see everything.",
  },
  {
    code: "form_factor",
    label: "Form factor",
    applies_to: "desktop",
    is_required: false,
    sort_order: 8,
    help_text:
      "How big the machine is. A thin client sits behind a monitor; a tower has room to grow.",
  },
  {
    code: "cpu",
    label: "Processor",
    applies_to: "both",
    is_required: true,
    sort_order: 10,
    help_text:
      "The engine of the machine. More cores help with editing and rendering; higher clock speed helps with games.",
  },
  {
    code: "memory",
    label: "Memory (RAM)",
    applies_to: "both",
    is_required: true,
    allows_multiple: true,
    max_quantity: 4,
    sort_order: 20,
    help_text:
      "How much the machine can juggle at once. 16GB is comfortable; 32GB and up for heavy editing.",
  },
  {
    code: "storage",
    label: "Storage (SSD)",
    applies_to: "both",
    is_required: true,
    allows_multiple: true,
    max_quantity: 4,
    sort_order: 30,
    help_text:
      "Where everything lives. An NVMe drive is what makes the whole machine feel fast.",
  },
  {
    code: "gpu",
    label: "Graphics card",
    applies_to: "both",
    is_required: false,
    sort_order: 40,
    help_text:
      "Needed for gaming, 3D and video work. Office machines can leave this empty.",
  },
  {
    code: "gpu_ram",
    label: "Graphics memory",
    applies_to: "both",
    is_required: false,
    sort_order: 45,
    help_text:
      "How much memory the graphics card has. More helps with large scenes, high resolutions and video.",
  },
  {
    code: "laptop_display",
    label: "Screen size",
    applies_to: "laptop",
    is_required: true,
    sort_order: 50,
    help_text: "Bigger is easier to work on; smaller is easier to carry.",
  },
  {
    code: "operating_system",
    label: "Operating system",
    applies_to: "both",
    is_required: true,
    sort_order: 60,
    help_text: "What it boots into. We install and activate it before delivery.",
  },

  // ── Everything below is optional. A specialist fills in whatever the
  //    customer leaves blank, which is the whole point of the change.
  {
    code: "motherboard",
    label: "Motherboard",
    applies_to: "desktop",
    is_required: false,
    sort_order: 70,
    help_text: "Everything plugs into this. It has to match your processor's socket.",
  },
  {
    code: "psu",
    label: "Power supply",
    applies_to: "desktop",
    is_required: false,
    sort_order: 80,
    help_text: "Powers everything, sized to your parts with room to spare.",
  },
  {
    code: "case",
    label: "Case",
    applies_to: "desktop",
    is_required: false,
    sort_order: 90,
    help_text:
      "Has to be big enough for your motherboard, graphics card and cooler.",
  },
  {
    code: "cpu_cooler",
    label: "CPU cooling",
    applies_to: "desktop",
    is_required: false,
    sort_order: 100,
    help_text: "Keeps the processor in range under load.",
  },
  {
    code: "case_cooling",
    label: "Case fans",
    applies_to: "desktop",
    is_required: false,
    sort_order: 110,
    help_text: "Moves air through the case.",
  },
  {
    code: "laptop_keyboard",
    label: "Keyboard layout",
    applies_to: "laptop",
    is_required: false,
    sort_order: 120,
  },
  {
    code: "laptop_battery",
    label: "Battery & charger",
    applies_to: "laptop",
    is_required: false,
    sort_order: 130,
  },
  {
    code: "monitor",
    label: "Monitor",
    applies_to: "both",
    is_required: false,
    sort_order: 140,
  },
  {
    code: "peripherals",
    label: "Keyboard & mouse",
    applies_to: "both",
    is_required: false,
    sort_order: 150,
  },
  {
    code: "networking",
    label: "Networking",
    applies_to: "both",
    is_required: false,
    sort_order: 160,
  },
  {
    code: "services",
    label: "Setup & services",
    applies_to: "both",
    is_required: false,
    sort_order: 170,
  },

  // Retired. The laptop now shares the processor, memory and storage slots
  // with the desktop, so these would otherwise show a second "Processor"
  // dropdown on the same page. Marked retired rather than deleted: existing
  // build requests reference them and their history should stay readable.
  {
    code: "laptop_model",
    label: "Model",
    applies_to: "retired",
    is_required: false,
    sort_order: 900,
  },
  {
    code: "laptop_cpu",
    label: "Processor",
    applies_to: "retired",
    is_required: false,
    sort_order: 901,
  },
  {
    code: "laptop_memory",
    label: "Memory",
    applies_to: "retired",
    is_required: false,
    sort_order: 902,
  },
]

// ─── Parts ────────────────────────────────────────────────────────────────
//
// No prices. What a build costs depends on what the parts cost on the day
// we source them, so the catalogue describes parts and a specialist quotes
// the machine. A number here would be a guess wearing the clothes of a
// price.

const BRANDS = ["Apple", "Dell", "HP", "Lenovo", "ASUS", "Acer", "Custom build"]

export const OPTIONS: CatalogOption[] = [
  // Brand — the selection every other list filters against.
  ...BRANDS.map((name, i) => ({
    category: "brand",
    label: name,
    brand: name,
    attributes: { brand: name },
    sort_order: (i + 1) * 10,
  })),

  // Form factor. Apple sells a tower and a Studio; everyone else sells thin
  // clients, desktops and towers. Tower appears for both, so it carries no
  // `brands` key at all.
  {
    category: "form_factor",
    label: "Thin Client",
    attributes: { brands: BRANDS.filter((b) => b !== "Apple") },
    sort_order: 10,
  },
  {
    category: "form_factor",
    label: "Desktop PC",
    attributes: { brands: BRANDS.filter((b) => b !== "Apple") },
    sort_order: 20,
  },
  { category: "form_factor", label: "Tower", sort_order: 30 },
  {
    category: "form_factor",
    label: "Studio",
    attributes: { brands: ["Apple"] },
    sort_order: 40,
  },

  // Processors. Apple's are the reason brand filtering exists: an M-series
  // chip cannot go in anything else, and an Intel chip cannot go in a Mac.
  {
    category: "cpu",
    label: "Apple M3",
    brand: "Apple",
    attributes: { brands: ["Apple"], cores: 8, integrated_graphics: true },
    sort_order: 10,
  },
  {
    category: "cpu",
    label: "Apple M3 Pro",
    brand: "Apple",
    attributes: { brands: ["Apple"], cores: 12, integrated_graphics: true },
    sort_order: 20,
  },
  {
    category: "cpu",
    label: "Apple M3 Max",
    brand: "Apple",
    attributes: { brands: ["Apple"], cores: 16, integrated_graphics: true },
    sort_order: 30,
  },
  {
    category: "cpu",
    label: "Intel Core i5-13400F",
    attributes: {
      brands: BRANDS.filter((b) => b !== "Apple"),
      socket: "LGA1700",
      cores: 10,
      tdp: 65,
      max_balanced_gpu_tier: 3,
    },
    sort_order: 40,
  },
  {
    category: "cpu",
    label: "Intel Core i7-13700",
    attributes: {
      brands: BRANDS.filter((b) => b !== "Apple"),
      socket: "LGA1700",
      cores: 16,
      tdp: 65,
      max_balanced_gpu_tier: 5,
    },
    sort_order: 50,
  },
  {
    category: "cpu",
    label: "AMD Ryzen 5 7600X",
    attributes: {
      brands: BRANDS.filter((b) => b !== "Apple"),
      socket: "AM5",
      cores: 6,
      tdp: 105,
      max_balanced_gpu_tier: 3,
    },
    sort_order: 60,
  },
  {
    category: "cpu",
    label: "AMD Ryzen 7 7700X",
    attributes: {
      brands: BRANDS.filter((b) => b !== "Apple"),
      socket: "AM5",
      cores: 8,
      tdp: 105,
      max_balanced_gpu_tier: 4,
    },
    sort_order: 70,
  },

  // Memory
  { category: "memory", label: "8GB", attributes: { capacity_gb: 8 }, sort_order: 10 },
  { category: "memory", label: "16GB", attributes: { capacity_gb: 16 }, sort_order: 20 },
  { category: "memory", label: "32GB", attributes: { capacity_gb: 32 }, sort_order: 30 },
  { category: "memory", label: "64GB", attributes: { capacity_gb: 64 }, sort_order: 40 },

  // Storage
  { category: "storage", label: "256GB SSD", attributes: { capacity_gb: 256, interface: "NVMe" }, sort_order: 10 },
  { category: "storage", label: "512GB SSD", attributes: { capacity_gb: 512, interface: "NVMe" }, sort_order: 20 },
  { category: "storage", label: "1TB SSD", attributes: { capacity_gb: 1000, interface: "NVMe" }, sort_order: 30 },
  { category: "storage", label: "2TB SSD", attributes: { capacity_gb: 2000, interface: "NVMe" }, sort_order: 40 },

  // Graphics
  { category: "gpu", label: "Integrated graphics", attributes: { tier: 0 }, sort_order: 10 },
  { category: "gpu", label: "NVIDIA RTX 4060", attributes: { brands: BRANDS.filter((b) => b !== "Apple"), tier: 3, recommended_psu_watts: 550 }, sort_order: 20 },
  { category: "gpu", label: "NVIDIA RTX 4070 Super", attributes: { brands: BRANDS.filter((b) => b !== "Apple"), tier: 5, recommended_psu_watts: 750 }, sort_order: 30 },

  { category: "gpu_ram", label: "4GB", attributes: { vram_gb: 4 }, sort_order: 10 },
  { category: "gpu_ram", label: "8GB", attributes: { vram_gb: 8 }, sort_order: 20 },
  { category: "gpu_ram", label: "12GB", attributes: { vram_gb: 12 }, sort_order: 30 },
  { category: "gpu_ram", label: "16GB", attributes: { vram_gb: 16 }, sort_order: 40 },

  // Screen size — laptop only, and required there.
  { category: "laptop_display", label: "13 inch", attributes: { size_in: 13 }, sort_order: 10 },
  { category: "laptop_display", label: "14 inch", attributes: { size_in: 14 }, sort_order: 20 },
  { category: "laptop_display", label: "15.6 inch", attributes: { size_in: 15.6 }, sort_order: 30 },
  { category: "laptop_display", label: "16 inch", attributes: { size_in: 16 }, sort_order: 40 },
  { category: "laptop_display", label: "17 inch", attributes: { size_in: 17 }, sort_order: 50 },

  // Operating system. macOS only on Apple; Windows and Linux elsewhere.
  { category: "operating_system", label: "macOS", attributes: { brands: ["Apple"], family: "macOS" }, sort_order: 10 },
  { category: "operating_system", label: "Windows 11 Home", attributes: { brands: BRANDS.filter((b) => b !== "Apple"), family: "Windows", edition: "Home", requires_tpm: true }, sort_order: 20 },
  { category: "operating_system", label: "Windows 11 Pro", attributes: { brands: BRANDS.filter((b) => b !== "Apple"), family: "Windows", edition: "Pro", requires_tpm: true }, sort_order: 30 },
  { category: "operating_system", label: "Ubuntu 24.04 LTS", attributes: { brands: BRANDS.filter((b) => b !== "Apple"), family: "Linux", requires_tpm: false }, sort_order: 40 },

  // Optional desktop internals, kept from the existing catalogue.
  { category: "motherboard", label: "ASUS PRIME B650M-A", attributes: { socket: "AM5", form_factor: "mATX", memory_slots: 4, max_memory_gb: 128, supported_memory_types: ["DDR5"], supported_storage_interfaces: ["NVMe", "SATA"], has_tpm: true, m2_slots: 2 }, sort_order: 10 },
  { category: "motherboard", label: "MSI PRO B760M", attributes: { socket: "LGA1700", form_factor: "mATX", memory_slots: 4, max_memory_gb: 128, supported_memory_types: ["DDR5"], supported_storage_interfaces: ["NVMe", "SATA"], has_tpm: true, m2_slots: 2 }, sort_order: 20 },
  { category: "psu", label: "Corsair RM650e", attributes: { wattage: 650, efficiency: "Gold", modular: "Full" }, sort_order: 10 },
  { category: "psu", label: "Corsair RM850e", attributes: { wattage: 850, efficiency: "Gold", modular: "Full" }, sort_order: 20 },
  { category: "case", label: "NZXT H5 Flow", attributes: { supported_form_factors: ["ATX", "mATX", "Mini-ITX"], max_gpu_length_mm: 365, max_cooler_height_mm: 165, included_fans: 2 }, sort_order: 10 },
  { category: "case", label: "Cooler Master NR200", attributes: { supported_form_factors: ["Mini-ITX"], max_gpu_length_mm: 330, max_cooler_height_mm: 155, included_fans: 1 }, sort_order: 20 },
  { category: "cpu_cooler", label: "DeepCool AK400", attributes: { type: "Air", sockets: ["AM5", "LGA1700"], height_mm: 155, tdp_rating: 220 }, sort_order: 10 },
  { category: "cpu_cooler", label: "Noctua NH-D15", attributes: { type: "Air", sockets: ["AM5", "LGA1700"], height_mm: 165, tdp_rating: 250 }, sort_order: 20 },
  { category: "case_cooling", label: "Arctic P12 120mm (3-pack)", attributes: { size_mm: 120, airflow_cfm: 56, noise_dba: 22 }, sort_order: 10 },

  // Optional extras
  { category: "monitor", label: 'Dell 27" 1440p 165Hz', attributes: { size_in: 27, resolution: "2560x1440", refresh_hz: 165, panel: "IPS" }, sort_order: 10 },
  { category: "peripherals", label: "Logitech MK270 keyboard & mouse", attributes: { kind: "Combo", connection: "Wireless" }, sort_order: 10 },
  { category: "services", label: "Assembly & testing", attributes: { kind: "Assembly" }, sort_order: 10 },
  { category: "services", label: "Data transfer from your old machine", attributes: { kind: "Data transfer" }, sort_order: 20 },
]
