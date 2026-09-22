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
    applies_to: "retired",
    is_required: false,
    sort_order: 120,
  },
  {
    code: "laptop_battery",
    label: "Battery & charger",
    applies_to: "retired",
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
  // Condition — the first question a Nigerian laptop buyer actually asks,
  // and the one that moves the price most. Not required: a customer who
  // does not mind should not be made to choose.
  {
    code: "condition",
    label: "Condition",
    applies_to: "both",
    is_required: false,
    sort_order: 6,
    help_text: "New, imported pre-owned, locally used or refurbished.",
  },
  // Laptop chassis style. Separate from the desktop form_factor slot
  // because the two share no options — a tower is not a 2-in-1.
  {
    code: "laptop_form_factor",
    label: "Type",
    applies_to: "laptop",
    is_required: false,
    sort_order: 7,
    help_text: "Standard, thin-and-light, convertible, detachable or rugged.",
  },
  // Spec §8–12: the laptop's charger is a filter, not a compatibility
  // promise — the exact connector and output still have to match.
  {
    code: "laptop_charger",
    label: "Charger / power adapter",
    applies_to: "laptop",
    is_required: false,
    sort_order: 115,
    help_text:
      "Leave on Match my laptop unless you need a specific wattage.",
  },
  {
    code: "laptop_bag",
    label: "Bag / sleeve",
    applies_to: "laptop",
    is_required: false,
    sort_order: 135,
  },
  {
    code: "laptop_cooling",
    label: "Cooling / stand",
    applies_to: "laptop",
    is_required: false,
    sort_order: 137,
  },
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

// Spec §1. The first six carry the most visibility in Nigeria; the rest
// broaden catalogue coverage rather than claim a popularity ranking.
// "Any brand" replaces "None" — a shopper with no preference still wants a
// laptop, and "None" reads as though they are declining one.
const BRANDS = [
  "HP",
  "Dell",
  "Lenovo",
  "Apple",
  "ASUS",
  "Acer",
  "Microsoft",
  "MSI",
  "Samsung",
  "Toshiba / Dynabook",
  "Huawei",
  "Gigabyte",
  "Custom build",
  "Any brand",
]

export const OPTIONS: CatalogOption[] = [
  // Generated from the Nigerian laptop specification (see
  // app/ceedmart/docs/nigerian-laptop-spec-options.md). Platform is expressed through
  // the existing `brands` filter: a Windows-only option lists every brand
  // except Apple, a Mac-only option lists Apple alone, and an option for
  // both carries no filter at all.
  { category: "brand", label: "HP", brand: "HP", attributes: { brand: "HP", platform: "windows" }, sort_order: 10 },
  { category: "brand", label: "Dell", brand: "Dell", attributes: { brand: "Dell", platform: "windows" }, sort_order: 20 },
  { category: "brand", label: "Lenovo", brand: "Lenovo", attributes: { brand: "Lenovo", platform: "windows" }, sort_order: 30 },
  { category: "brand", label: "Apple", brand: "Apple", attributes: { brand: "Apple", platform: "mac" }, sort_order: 40 },
  { category: "brand", label: "ASUS", brand: "ASUS", attributes: { brand: "ASUS", platform: "windows" }, sort_order: 50 },
  { category: "brand", label: "Acer", brand: "Acer", attributes: { brand: "Acer", platform: "windows" }, sort_order: 60 },
  { category: "brand", label: "Microsoft", brand: "Microsoft", attributes: { brand: "Microsoft", platform: "windows" }, sort_order: 70 },
  { category: "brand", label: "MSI", brand: "MSI", attributes: { brand: "MSI", platform: "windows" }, sort_order: 80 },
  { category: "brand", label: "Samsung", brand: "Samsung", attributes: { brand: "Samsung", platform: "windows" }, sort_order: 90 },
  { category: "brand", label: "Toshiba / Dynabook", brand: "Toshiba / Dynabook", attributes: { brand: "Toshiba / Dynabook", platform: "windows" }, sort_order: 100 },
  { category: "brand", label: "Huawei", brand: "Huawei", attributes: { brand: "Huawei", platform: "windows" }, sort_order: 110 },
  { category: "brand", label: "Gigabyte", brand: "Gigabyte", attributes: { brand: "Gigabyte", platform: "windows" }, sort_order: 120 },
  { category: "brand", label: "Custom build", brand: "Custom build", attributes: { brand: "Custom build", platform: "windows" }, sort_order: 130 },
  { category: "brand", label: "Any brand", brand: "Any brand", attributes: { brand: "Any brand" }, sort_order: 140 },
  { category: "condition", label: "New", attributes: { note: "Sealed, with manufacturer warranty" }, sort_order: 10 },
  { category: "condition", label: "Foreign-used", attributes: { note: "Imported pre-owned, graded before sale" }, sort_order: 20 },
  { category: "condition", label: "Locally-used", attributes: { note: "Pre-owned within Nigeria" }, sort_order: 30 },
  { category: "condition", label: "Refurbished", attributes: { note: "Restored and tested, with our own warranty" }, sort_order: 40 },
  { category: "laptop_form_factor", label: "Standard laptop", sort_order: 10 },
  { category: "laptop_form_factor", label: "Thin-and-light laptop", sort_order: 20 },
  { category: "laptop_form_factor", label: "Convertible 2-in-1, 360° hinge", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 30 },
  { category: "laptop_form_factor", label: "Detachable 2-in-1", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 40 },
  { category: "laptop_form_factor", label: "Rugged laptop", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 50 },
  { category: "laptop_display", label: "11.6″", attributes: { size_in: 11.6 }, sort_order: 10 },
  { category: "laptop_display", label: "12.5″", attributes: { size_in: 12.5 }, sort_order: 20 },
  { category: "laptop_display", label: "13″", attributes: { size_in: 13.0 }, sort_order: 30 },
  { category: "laptop_display", label: "13.3″", attributes: { size_in: 13.3 }, sort_order: 40 },
  { category: "laptop_display", label: "13.6″", attributes: { size_in: 13.6 }, sort_order: 50 },
  { category: "laptop_display", label: "14″", attributes: { size_in: 14.0 }, sort_order: 60 },
  { category: "laptop_display", label: "14.2″", attributes: { size_in: 14.2 }, sort_order: 70 },
  { category: "laptop_display", label: "15″", attributes: { size_in: 15.0 }, sort_order: 80 },
  { category: "laptop_display", label: "15.3″", attributes: { size_in: 15.3 }, sort_order: 90 },
  { category: "laptop_display", label: "15.6″", attributes: { size_in: 15.6 }, sort_order: 100 },
  { category: "laptop_display", label: "16″", attributes: { size_in: 16.0 }, sort_order: 110 },
  { category: "laptop_display", label: "17.3″", attributes: { size_in: 17.3 }, sort_order: 120 },
  { category: "cpu", label: "Intel Celeron / Pentium — older budget machines", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 10 },
  { category: "cpu", label: "Intel Processor N-series, e.g. N100/N200", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 20 },
  { category: "cpu", label: "Intel Core i3 — 6th–10th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 30 },
  { category: "cpu", label: "Intel Core i3 — 11th–13th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 40 },
  { category: "cpu", label: "Intel Core i5 — 6th–7th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 50 },
  { category: "cpu", label: "Intel Core i5 — 8th–10th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 60 },
  { category: "cpu", label: "Intel Core i5 — 11th–13th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 70 },
  { category: "cpu", label: "Intel Core i7 — 6th–7th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 80 },
  { category: "cpu", label: "Intel Core i7 — 8th–10th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 90 },
  { category: "cpu", label: "Intel Core i7 — 11th–14th generation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 100 },
  { category: "cpu", label: "AMD Ryzen 3 / Ryzen 5", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 110 },
  { category: "cpu", label: "AMD Ryzen 7 / Ryzen 9", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], group: true }, sort_order: 120 },
  { category: "cpu", label: "Intel Core i5 — older Intel Macs", attributes: { brands: ["Apple"], group: true }, sort_order: 130 },
  { category: "cpu", label: "Intel Core i7 — older Intel Macs", attributes: { brands: ["Apple"], group: true }, sort_order: 140 },
  { category: "cpu", label: "Apple M1", attributes: { brands: ["Apple"], group: true }, sort_order: 150 },
  { category: "cpu", label: "Apple M1 Pro / M1 Max", attributes: { brands: ["Apple"], group: true }, sort_order: 160 },
  { category: "cpu", label: "Apple M2", attributes: { brands: ["Apple"], group: true }, sort_order: 170 },
  { category: "cpu", label: "Apple M2 Pro / M2 Max", attributes: { brands: ["Apple"], group: true }, sort_order: 180 },
  { category: "cpu", label: "Apple M3 / M3 Pro / M3 Max", attributes: { brands: ["Apple"], group: true }, sort_order: 190 },
  { category: "cpu", label: "Apple M4 / M4 Pro / M4 Max", attributes: { brands: ["Apple"], group: true }, sort_order: 200 },
  { category: "memory", label: "8GB", attributes: { capacity_gb: 8 }, sort_order: 10 },
  { category: "memory", label: "16GB", attributes: { capacity_gb: 16 }, sort_order: 20 },
  { category: "memory", label: "32GB", attributes: { capacity_gb: 32 }, sort_order: 30 },
  { category: "memory", label: "4GB", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], capacity_gb: 4 }, sort_order: 40 },
  { category: "memory", label: "12GB", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], capacity_gb: 12 }, sort_order: 50 },
  { category: "memory", label: "18GB", attributes: { brands: ["Apple"], capacity_gb: 18, label_as: "Unified memory" }, sort_order: 60 },
  { category: "memory", label: "24GB", attributes: { capacity_gb: 24 }, sort_order: 70 },
  { category: "memory", label: "36GB", attributes: { brands: ["Apple"], capacity_gb: 36, label_as: "Unified memory" }, sort_order: 80 },
  { category: "memory", label: "48GB", attributes: { capacity_gb: 48 }, sort_order: 90 },
  { category: "memory", label: "64GB", attributes: { capacity_gb: 64 }, sort_order: 100 },
  { category: "memory", label: "96GB", attributes: { capacity_gb: 96 }, sort_order: 110 },
  { category: "memory", label: "128GB", attributes: { capacity_gb: 128 }, sort_order: 120 },
  { category: "storage", label: "256GB NVMe SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 10 },
  { category: "storage", label: "512GB NVMe SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 20 },
  { category: "storage", label: "1TB NVMe SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 30 },
  { category: "storage", label: "128GB SATA SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 40 },
  { category: "storage", label: "256GB SATA SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 50 },
  { category: "storage", label: "512GB SATA SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 60 },
  { category: "storage", label: "1TB SATA SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 70 },
  { category: "storage", label: "2TB NVMe SSD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 80 },
  { category: "storage", label: "500GB HDD — legacy", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 90 },
  { category: "storage", label: "1TB HDD — legacy", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 100 },
  { category: "storage", label: "128GB SSD + 500GB HDD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 110 },
  { category: "storage", label: "256GB SSD + 1TB HDD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 120 },
  { category: "storage", label: "512GB SSD + 1TB HDD", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 130 },
  { category: "storage", label: "64GB eMMC — basic models", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 140 },
  { category: "storage", label: "128GB eMMC — basic models", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 150 },
  { category: "storage", label: "128GB SSD", attributes: { brands: ["Apple"] }, sort_order: 160 },
  { category: "storage", label: "256GB SSD", attributes: { brands: ["Apple"] }, sort_order: 170 },
  { category: "storage", label: "512GB SSD", attributes: { brands: ["Apple"] }, sort_order: 180 },
  { category: "storage", label: "1TB SSD", attributes: { brands: ["Apple"] }, sort_order: 190 },
  { category: "storage", label: "2TB SSD", attributes: { brands: ["Apple"] }, sort_order: 200 },
  { category: "storage", label: "4TB SSD", attributes: { brands: ["Apple"] }, sort_order: 210 },
  { category: "storage", label: "8TB SSD", attributes: { brands: ["Apple"] }, sort_order: 220 },
  { category: "gpu", label: "Intel HD Graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 10 },
  { category: "gpu", label: "Intel UHD Graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 20 },
  { category: "gpu", label: "Intel Iris / Iris Plus", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 30 },
  { category: "gpu", label: "Intel Iris Xe", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 40 },
  { category: "gpu", label: "Intel Arc integrated graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 50 },
  { category: "gpu", label: "AMD Radeon integrated graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 60 },
  { category: "gpu", label: "AMD Radeon Vega integrated graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 70 },
  { category: "gpu", label: "NVIDIA GeForce MX-series", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 80 },
  { category: "gpu", label: "NVIDIA GeForce GTX 1050 / 1050 Ti", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 90 },
  { category: "gpu", label: "NVIDIA GeForce GTX 1650", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 100 },
  { category: "gpu", label: "NVIDIA GeForce GTX 1660 Ti", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 110 },
  { category: "gpu", label: "NVIDIA GeForce RTX 2050", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 120 },
  { category: "gpu", label: "NVIDIA GeForce RTX 2060", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 130 },
  { category: "gpu", label: "NVIDIA GeForce RTX 3050 / 3050 Ti", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 140 },
  { category: "gpu", label: "NVIDIA GeForce RTX 3060 / 3070", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 150 },
  { category: "gpu", label: "NVIDIA GeForce RTX 4050 / 4060 / 4070", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 160 },
  { category: "gpu", label: "NVIDIA Quadro / RTX workstation graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 170 },
  { category: "gpu", label: "AMD Radeon Pro dedicated graphics", attributes: { brands: ["Apple"] }, sort_order: 180 },
  { category: "gpu", label: "Apple integrated GPU — base M-series chip", attributes: { brands: ["Apple"] }, sort_order: 190 },
  { category: "gpu", label: "Apple integrated GPU — Pro / Max chip", attributes: { brands: ["Apple"] }, sort_order: 200 },
  { category: "gpu_ram", label: "Shared system memory — integrated graphics", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 10 },
  { category: "gpu_ram", label: "Unified memory — Apple Silicon", attributes: { brands: ["Apple"] }, sort_order: 20 },
  { category: "gpu_ram", label: "2GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 30 },
  { category: "gpu_ram", label: "3GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 40 },
  { category: "gpu_ram", label: "4GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 50 },
  { category: "gpu_ram", label: "6GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 60 },
  { category: "gpu_ram", label: "8GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 70 },
  { category: "gpu_ram", label: "12GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 80 },
  { category: "gpu_ram", label: "16GB dedicated", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 90 },
  { category: "operating_system", label: "Windows 11 Home", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Personal use" }, sort_order: 10 },
  { category: "operating_system", label: "Windows 11 Pro", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Business and professional use" }, sort_order: 20 },
  { category: "operating_system", label: "Windows 10 Home — legacy", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Support ended 14 October 2025" }, sort_order: 30 },
  { category: "operating_system", label: "Windows 10 Pro — legacy", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Support ended 14 October 2025" }, sort_order: 40 },
  { category: "operating_system", label: "macOS — latest compatible version", attributes: { brands: ["Apple"], note: "Included with every Mac" }, sort_order: 50 },
  { category: "operating_system", label: "Ubuntu LTS", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Optional Linux offering" }, sort_order: 60 },
  { category: "operating_system", label: "Linux Mint", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Optional Linux offering" }, sort_order: 70 },
  { category: "operating_system", label: "FreeDOS / no OS", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "You install the operating system yourself" }, sort_order: 80 },
  { category: "operating_system", label: "ChromeOS", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"], note: "Chromebooks only" }, sort_order: 90 },
  { category: "laptop_charger", label: "Match my laptop — we supply the right adapter", sort_order: 10 },
  { category: "laptop_charger", label: "30W", attributes: { watts: 30 }, sort_order: 20 },
  { category: "laptop_charger", label: "35W", attributes: { watts: 35 }, sort_order: 30 },
  { category: "laptop_charger", label: "45W", attributes: { watts: 45 }, sort_order: 40 },
  { category: "laptop_charger", label: "60W", attributes: { watts: 60 }, sort_order: 50 },
  { category: "laptop_charger", label: "65W", attributes: { watts: 65 }, sort_order: 60 },
  { category: "laptop_charger", label: "67W", attributes: { watts: 67 }, sort_order: 70 },
  { category: "laptop_charger", label: "70W", attributes: { watts: 70 }, sort_order: 80 },
  { category: "laptop_charger", label: "85W", attributes: { watts: 85 }, sort_order: 90 },
  { category: "laptop_charger", label: "90W", attributes: { watts: 90 }, sort_order: 100 },
  { category: "laptop_charger", label: "96W", attributes: { watts: 96 }, sort_order: 110 },
  { category: "laptop_charger", label: "120W", attributes: { watts: 120 }, sort_order: 120 },
  { category: "laptop_charger", label: "140W", attributes: { watts: 140 }, sort_order: 130 },
  { category: "laptop_bag", label: "No extra bag", sort_order: 10 },
  { category: "laptop_bag", label: "13–14″ sleeve", sort_order: 20 },
  { category: "laptop_bag", label: "15–16″ sleeve", sort_order: 30 },
  { category: "laptop_bag", label: "17″ sleeve", sort_order: 40 },
  { category: "laptop_bag", label: "13–14″ shoulder bag", sort_order: 50 },
  { category: "laptop_bag", label: "15–16″ shoulder bag", sort_order: 60 },
  { category: "laptop_bag", label: "Standard laptop backpack", sort_order: 70 },
  { category: "laptop_bag", label: "Padded laptop backpack", sort_order: 80 },
  { category: "laptop_bag", label: "Water-resistant laptop backpack", sort_order: 90 },
  { category: "laptop_bag", label: "Laptop briefcase", sort_order: 100 },
  { category: "laptop_cooling", label: "None", sort_order: 10 },
  { category: "laptop_cooling", label: "Basic cooling pad", sort_order: 20 },
  { category: "laptop_cooling", label: "Multi-fan cooling pad", sort_order: 30 },
  { category: "laptop_cooling", label: "Fixed laptop stand", sort_order: 40 },
  { category: "laptop_cooling", label: "Adjustable laptop stand", sort_order: 50 },
  { category: "monitor", label: "No external monitor", sort_order: 10 },
  { category: "monitor", label: "19–20″ basic monitor", sort_order: 20 },
  { category: "monitor", label: "21.5″ Full HD", sort_order: 30 },
  { category: "monitor", label: "22″ Full HD IPS", sort_order: 40 },
  { category: "monitor", label: "24″ Full HD IPS", sort_order: 50 },
  { category: "monitor", label: "24″ Full HD, 144Hz+", sort_order: 60 },
  { category: "monitor", label: "27″ Full HD IPS", sort_order: 70 },
  { category: "monitor", label: "27″ QHD IPS", sort_order: 80 },
  { category: "monitor", label: "27″ QHD, 144Hz+", sort_order: 90 },
  { category: "monitor", label: "27″ 4K IPS", sort_order: 100 },
  { category: "monitor", label: "32″ 4K", sort_order: 110 },
  { category: "monitor", label: "15.6″ portable USB-C monitor", sort_order: 120 },
  { category: "peripherals", label: "Built-in keyboard and touchpad only", sort_order: 10 },
  { category: "peripherals", label: "Wired USB mouse", sort_order: 20 },
  { category: "peripherals", label: "Wireless USB-receiver mouse", sort_order: 30 },
  { category: "peripherals", label: "Bluetooth mouse", sort_order: 40 },
  { category: "peripherals", label: "Wired keyboard and mouse bundle", sort_order: 50 },
  { category: "peripherals", label: "Wireless keyboard and mouse bundle", sort_order: 60 },
  { category: "peripherals", label: "Compact Bluetooth keyboard", sort_order: 70 },
  { category: "peripherals", label: "Full-size keyboard with number pad", sort_order: 80 },
  { category: "peripherals", label: "Mechanical keyboard", sort_order: 90 },
  { category: "peripherals", label: "Ergonomic mouse", sort_order: 100 },
  { category: "peripherals", label: "Apple Magic Mouse", attributes: { brands: ["Apple"] }, sort_order: 110 },
  { category: "peripherals", label: "Apple Magic Keyboard", attributes: { brands: ["Apple"] }, sort_order: 120 },
  { category: "networking", label: "Built-in Wi-Fi only — no extras", sort_order: 10 },
  { category: "networking", label: "USB Wi-Fi adapter", sort_order: 20 },
  { category: "networking", label: "USB-A Gigabit Ethernet adapter", sort_order: 30 },
  { category: "networking", label: "USB-C Gigabit Ethernet adapter", sort_order: 40 },
  { category: "networking", label: "USB-C dock with Ethernet", sort_order: 50 },
  { category: "networking", label: "4G MiFi router", sort_order: 60 },
  { category: "networking", label: "5G mobile router", sort_order: 70 },
  { category: "services", label: "Standard initial setup", sort_order: 10 },
  { category: "services", label: "OS updates", sort_order: 20 },
  { category: "services", label: "Driver and firmware updates", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 30 },
  { category: "services", label: "Genuine Windows licence and activation", attributes: { brands: ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Microsoft", "MSI", "Samsung", "Toshiba / Dynabook", "Huawei", "Gigabyte", "Custom build", "Any brand"] }, sort_order: 40 },
  { category: "services", label: "macOS reinstall", attributes: { brands: ["Apple"] }, sort_order: 50 },
  { category: "services", label: "Microsoft 365 installation with valid subscription", sort_order: 60 },
  { category: "services", label: "Free office-suite installation", sort_order: 70 },
  { category: "services", label: "Data transfer from an old computer", sort_order: 80 },
  { category: "services", label: "Email and browser setup", sort_order: 90 },
  { category: "services", label: "Printer/scanner setup", sort_order: 100 },
  { category: "services", label: "Backup configuration", sort_order: 110 },
  { category: "services", label: "Device encryption setup, where supported", sort_order: 120 },
  { category: "services", label: "RAM upgrade and testing", sort_order: 130 },
  { category: "services", label: "SSD upgrade and data migration", sort_order: 140 },
  { category: "services", label: "Battery-health and hardware diagnostic report", sort_order: 150 },

  // ── Desktop assembly ───────────────────────────────────────────────
  // Not covered by the laptop specification, and deliberately untouched.
  // A laptop hides these already: their categories are desktop-only, so
  // nobody is asked to choose a case for a MacBook.
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
  { category: "motherboard", label: "ASUS PRIME B650M-A", attributes: { socket: "AM5", form_factor: "mATX", memory_slots: 4, max_memory_gb: 128, supported_memory_types: ["DDR5"], supported_storage_interfaces: ["NVMe", "SATA"], has_tpm: true, m2_slots: 2 }, sort_order: 10 },
  { category: "motherboard", label: "MSI PRO B760M", attributes: { socket: "LGA1700", form_factor: "mATX", memory_slots: 4, max_memory_gb: 128, supported_memory_types: ["DDR5"], supported_storage_interfaces: ["NVMe", "SATA"], has_tpm: true, m2_slots: 2 }, sort_order: 20 },
  { category: "psu", label: "Corsair RM650e", attributes: { wattage: 650, efficiency: "Gold", modular: "Full" }, sort_order: 10 },
  { category: "psu", label: "Corsair RM850e", attributes: { wattage: 850, efficiency: "Gold", modular: "Full" }, sort_order: 20 },
  { category: "case", label: "NZXT H5 Flow", attributes: { supported_form_factors: ["ATX", "mATX", "Mini-ITX"], max_gpu_length_mm: 365, max_cooler_height_mm: 165, included_fans: 2 }, sort_order: 10 },
  { category: "case", label: "Cooler Master NR200", attributes: { supported_form_factors: ["Mini-ITX"], max_gpu_length_mm: 330, max_cooler_height_mm: 155, included_fans: 1 }, sort_order: 20 },
  { category: "cpu_cooler", label: "DeepCool AK400", attributes: { type: "Air", sockets: ["AM5", "LGA1700"], height_mm: 155, tdp_rating: 220 }, sort_order: 10 },
  { category: "cpu_cooler", label: "Noctua NH-D15", attributes: { type: "Air", sockets: ["AM5", "LGA1700"], height_mm: 165, tdp_rating: 250 }, sort_order: 20 },
  { category: "case_cooling", label: "Arctic P12 120mm (3-pack)", attributes: { size_mm: 120, airflow_cfm: 56, noise_dba: 22 }, sort_order: 10 },
]
