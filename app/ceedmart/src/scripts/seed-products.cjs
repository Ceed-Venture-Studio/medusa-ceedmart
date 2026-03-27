/**
 * Ceedmart Product Seed Script
 *
 * Reads "Ceedmart Gadgets Inventory Reseller.xlsx" and populates the Medusa DB
 * with categories, products, variants, pricing, and inventory.
 *
 * Usage:
 *   NODE_PATH=/tmp/node_modules node app/ceedmart/src/scripts/seed-products.cjs
 */

const pg = require("pg")
const XLSX = require("xlsx")
const crypto = require("crypto")
const path = require("path")
const XLSX_PATH = path.resolve(__dirname, "../../../../Ceedmart Gadgets Inventory Reseller.xlsx")

const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/ceedmart"

// Known IDs from the live DB
const SALES_CHANNEL_ID = "sc_01KMMZDX2HH3QGYABSKFJHBVP5"
const REGION_ID = "reg_01KMNAEGA3V1XGNZ4V0YK3BJMJ"
const SHIPPING_PROFILE_ID = "sp_01KMMZDKDJWJYJ0X1DF54789K6"
const CURRENCY_CODE = "ngn"

// ---------------------------------------------------------------------------
// ID generators (match Medusa prefix conventions)
// ---------------------------------------------------------------------------
function uid() {
  return crypto.randomBytes(12).toString("base64url").replace(/[_-]/g, "x")
}
const catId = () => `pcat_${uid()}`
const prodId = () => `prod_${uid()}`
const varId = () => `variant_${uid()}`
const optId = () => `opt_${uid()}`
const optValId = () => `optval_${uid()}`
const priceSetId = () => `priceset_${uid()}`
const priceId = () => `price_${uid()}`
const invItemId = () => `iitem_${uid()}`
const invLevelId = () => `ilev_${uid()}`
const linkId = () => `link_${uid()}`
const tagId = () => `ptag_${uid()}`
const typeId = () => `ptyp_${uid()}`
const colId = () => `pcol_${uid()}`

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------
function parseWeight(w) {
  if (!w) return null
  const s = String(w).replace(/[^0-9.]/g, "")
  const n = parseFloat(s)
  return isNaN(n) ? null : Math.round(n)
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100)
}

// ---------------------------------------------------------------------------
// Read spreadsheet
// ---------------------------------------------------------------------------
function readWorkbook() {
  const wb = XLSX.readFile(XLSX_PATH)
  return wb
}

function readGadgets(wb) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Gadgets"], { defval: null })
  return data.filter((r) => r.Brand || r.Model)
}

function readCCTV(wb) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets["CCTV Cameras"], { defval: null })
  return data.filter((r) => r.NAME || r.MODEL)
}

function readSolarPanels(wb) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Solar Panels"], { defval: null })
  return data.filter((r) => r["BRAND AND MODEL"])
}

function readSolarBatteries(wb) {
  const raw = XLSX.utils.sheet_to_json(wb.Sheets["Solar Batteries"], { defval: null })
  // First row is "BATTERIES" label, second row is actual headers
  // Data starts from row index 2
  const headerRow = raw[1]
  const headers = [
    headerRow.__EMPTY,       // BRAND AND MODEL
    headerRow.__EMPTY_1,     // CAPACITY
    headerRow.__EMPTY_2,     // BATTERY TYPE
    headerRow.__EMPTY_3,     // BATTERY CHEMISTRY
    headerRow.__EMPTY_4,     // DEPTH OF DISCHARGE
    headerRow.__EMPTY_5,     // WEIGHT
    headerRow.__EMPTY_6,     // MAX CHARGE RATE
    headerRow.__EMPTY_7,     // WARRANTY
    headerRow.__EMPTY_8,     // CERTIFICATION
    headerRow.__EMPTY_9,     // VOLTAGE
  ]
  const dataRows = raw.slice(2).filter((r) => r.__EMPTY)
  return dataRows.map((r) => ({
    "BRAND AND MODEL": r.__EMPTY,
    CAPACITY: r.__EMPTY_1,
    "BATTERY TYPE": r.__EMPTY_2,
    "BATTERY CHEMISTRY": r.__EMPTY_3,
    "DEPTH OF DISCHARGE": r.__EMPTY_4,
    WEIGHT: r.__EMPTY_5,
    "MAX CHARGE RATE": r.__EMPTY_6,
    WARRANTY: r.__EMPTY_7,
    CERTIFICATION: r.__EMPTY_8,
    VOLTAGE: r.__EMPTY_9,
  }))
}

function readPowerStations(wb) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Power Stations"], { defval: null })
  return data.filter((r) => r.MODEL)
}

function readAllInOne(wb) {
  const raw = XLSX.utils.sheet_to_json(wb.Sheets["All-in-one (InverterBattery)"], { defval: null })
  // First row has actual headers in the cells
  const dataRows = raw.slice(1).filter((r) => r["ALL IN ONE BATTERIES AND INVERTER"])
  return dataRows.map((r) => ({
    "SYSTEM TYPE": r["ALL IN ONE BATTERIES AND INVERTER"],
    "BATTERY CHEMISTRY": r.__EMPTY,
    CAPACITY: r.__EMPTY_1,
    "NOMINAL VOLTS": r.__EMPTY_2,
    DOD: r.__EMPTY_3,
    WEIGHT: r.__EMPTY_4,
    WARRANTY: r.__EMPTY_5,
  }))
}

// ---------------------------------------------------------------------------
// Build category tree
// ---------------------------------------------------------------------------
function buildCategories(gadgetRows) {
  const gadgetSubcats = [...new Set(gadgetRows.map((r) => r.Category).filter(Boolean))]

  // Top-level categories
  const topCats = [
    { name: "Gadgets", handle: "gadgets", children: gadgetSubcats },
    { name: "CCTV Cameras", handle: "cctv-cameras", children: [] },
    { name: "Solar Energy", handle: "solar-energy", children: ["Solar Panels", "Solar Batteries"] },
    { name: "Power Solutions", handle: "power-solutions", children: ["Power Stations", "All-in-one Inverter Battery"] },
  ]

  const categories = [] // { id, name, handle, parentId, mpath }
  const catMap = {} // name -> id

  for (const tc of topCats) {
    const id = catId()
    categories.push({
      id,
      name: tc.name,
      handle: tc.handle,
      parent_category_id: null,
      mpath: `${id}.`,
      is_active: true,
      is_internal: false,
      rank: categories.length,
    })
    catMap[tc.name] = id

    for (const child of tc.children) {
      const cid = catId()
      const childHandle = slugify(child)
      categories.push({
        id: cid,
        name: child,
        handle: childHandle,
        parent_category_id: id,
        mpath: `${id}.${cid}.`,
        is_active: true,
        is_internal: false,
        rank: categories.length,
      })
      catMap[child] = cid
    }
  }

  return { categories, catMap }
}

// ---------------------------------------------------------------------------
// Build product types & collections
// ---------------------------------------------------------------------------
function buildTypesAndCollections() {
  const types = [
    { id: typeId(), value: "Electronics" },
    { id: typeId(), value: "Security" },
    { id: typeId(), value: "Solar" },
    { id: typeId(), value: "Power" },
  ]
  const typeMap = {}
  for (const t of types) typeMap[t.value] = t.id

  const collections = [
    { id: colId(), title: "Gadgets & Electronics", handle: "gadgets-electronics" },
    { id: colId(), title: "CCTV & Security", handle: "cctv-security" },
    { id: colId(), title: "Solar Energy", handle: "solar-energy" },
    { id: colId(), title: "Power Solutions", handle: "power-solutions" },
  ]
  const colMap = {}
  for (const c of collections) colMap[c.title] = c.id

  return { types, typeMap, collections, colMap }
}

// ---------------------------------------------------------------------------
// Build products from all tabs
// ---------------------------------------------------------------------------
function buildProducts(wb, catMap, typeMap, colMap) {
  const products = []
  const variants = []
  const options = []
  const optionValues = []
  const variantOptions = []
  const priceSets = []
  const prices = []
  const inventoryItems = []
  const inventoryLevels = []
  const variantPriceSets = []
  const variantInventoryItems = []
  const productCategories = []
  const productSalesChannels = []
  const productShippingProfiles = []

  // Track handles for uniqueness
  const usedHandles = new Set()
  function uniqueHandle(base) {
    let h = slugify(base)
    if (!h) h = "product"
    let candidate = h
    let counter = 1
    while (usedHandles.has(candidate)) {
      candidate = `${h}-${counter++}`
    }
    usedHandles.add(candidate)
    return candidate
  }

  function addProduct({ title, handle, subtitle, description, weight, metadata, categoryNames, typeName, collectionTitle, status }) {
    const pid = prodId()
    const h = uniqueHandle(handle || title)

    products.push({
      id: pid,
      title,
      handle: h,
      subtitle: subtitle || null,
      description: description || null,
      is_giftcard: false,
      status: status || "published",
      weight: weight || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      collection_id: collectionTitle ? colMap[collectionTitle] || null : null,
      type_id: typeName ? typeMap[typeName] || null : null,
      discountable: true,
      origin_country: "NG",
    })

    for (const cn of categoryNames || []) {
      if (catMap[cn]) {
        productCategories.push({ product_id: pid, product_category_id: catMap[cn] })
      }
    }

    productSalesChannels.push({
      id: linkId(),
      product_id: pid,
      sales_channel_id: SALES_CHANNEL_ID,
    })

    productShippingProfiles.push({
      id: linkId(),
      product_id: pid,
      shipping_profile_id: SHIPPING_PROFILE_ID,
    })

    return pid
  }

  function addVariant({ productId, title, sku, weight, resellerPrice, retailPrice, stockQty, metadata }) {
    const vid = varId()

    variants.push({
      id: vid,
      title: title || "Default",
      sku: sku || null,
      product_id: productId,
      weight: parseWeight(weight),
      manage_inventory: true,
      allow_backorder: false,
      variant_rank: 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })

    // Price set for this variant
    const psid = priceSetId()
    priceSets.push({ id: psid })
    variantPriceSets.push({ id: linkId(), variant_id: vid, price_set_id: psid })

    // Retail price (main price)
    if (retailPrice && !isNaN(retailPrice)) {
      const amt = Math.round(Number(retailPrice))
      prices.push({
        id: priceId(),
        price_set_id: psid,
        currency_code: CURRENCY_CODE,
        amount: amt,
        raw_amount: JSON.stringify({ value: String(amt), precision: 20 }),
        title: "Retail",
      })
    }

    // Reseller price (via price list or as a second price - store as price rule)
    if (resellerPrice && !isNaN(resellerPrice)) {
      const amt = Math.round(Number(resellerPrice))
      prices.push({
        id: priceId(),
        price_set_id: psid,
        currency_code: CURRENCY_CODE,
        amount: amt,
        raw_amount: JSON.stringify({ value: String(amt), precision: 20 }),
        title: "Reseller",
      })
    }

    // Inventory
    if (stockQty !== null && stockQty !== undefined && !isNaN(stockQty)) {
      const iiid = invItemId()
      const ilid = invLevelId()
      const qty = Math.max(0, Math.round(Number(stockQty)))

      inventoryItems.push({
        id: iiid,
        sku: sku || null,
        title: title || "Default",
        requires_shipping: true,
        weight: parseWeight(weight),
      })

      // We need a stock location - use a default one
      inventoryLevels.push({
        id: ilid,
        inventory_item_id: iiid,
        location_id: "sloc_ceedmart_default",
        stocked_quantity: qty,
        reserved_quantity: 0,
        incoming_quantity: 0,
        raw_stocked_quantity: JSON.stringify({ value: String(qty), precision: 20 }),
        raw_reserved_quantity: JSON.stringify({ value: "0", precision: 20 }),
        raw_incoming_quantity: JSON.stringify({ value: "0", precision: 20 }),
      })

      variantInventoryItems.push({
        id: linkId(),
        variant_id: vid,
        inventory_item_id: iiid,
        required_quantity: 1,
      })
    }

    return vid
  }

  function addOption(productId, optTitle, optValue) {
    // Check if option already exists for this product
    let opt = options.find((o) => o.product_id === productId && o.title === optTitle)
    if (!opt) {
      opt = { id: optId(), title: optTitle, product_id: productId }
      options.push(opt)
    }
    // Check if value exists
    let ov = optionValues.find((v) => v.option_id === opt.id && v.value === optValue)
    if (!ov) {
      ov = { id: optValId(), value: optValue, option_id: opt.id }
      optionValues.push(ov)
    }
    return ov.id
  }

  function linkVariantOption(variantId, optionValueId) {
    variantOptions.push({ variant_id: variantId, option_value_id: optionValueId })
  }

  // -----------------------------------------------------------------------
  // 1. GADGETS
  // -----------------------------------------------------------------------
  const gadgets = readGadgets(wb)
  for (const row of gadgets) {
    const brand = (row.Brand || "").trim()
    const model = row.Model != null ? String(row.Model).trim() : ""
    const category = (row.Category || "").trim()
    const title = model ? `${brand} ${model}` : brand
    if (!title) continue

    const metadata = {}
    if (row.Processor) metadata.processor = row.Processor
    if (row["RAM (GB)"]) metadata.ram_gb = row["RAM (GB)"]
    if (row["SSD (GB / TB)"]) metadata.ssd = row["SSD (GB / TB)"]
    if (row["HDD (GB / TB)"]) metadata.hdd = row["HDD (GB / TB)"]
    if (row["Graphics Card"]) metadata.graphics_card = row["Graphics Card"]
    if (row["Graphics Memory "]) metadata.graphics_memory = row["Graphics Memory "]
    if (row['Screen Size "']) metadata.screen_size = row['Screen Size "']
    if (row.Resolution) metadata.resolution = row.Resolution
    if (row["Clock Speed (GHz)"]) metadata.clock_speed_ghz = row["Clock Speed (GHz)"]
    if (row["Operating System"]) metadata.os = row["Operating System"]
    if (row["SIM Type"]) metadata.sim_type = row["SIM Type"]
    if (row["Power Supply"]) metadata.power_supply = row["Power Supply"]
    if (row.Camera) metadata.camera = row.Camera
    if (row["Battery Capacity"]) metadata.battery_capacity = row["Battery Capacity"]
    if (row["Type (Inkjet/Laser)"]) metadata.printer_type = row["Type (Inkjet/Laser)"]
    if (row["Print Speed"]) metadata.print_speed = row["Print Speed"]
    if (row.Connectivity) metadata.connectivity = row.Connectivity
    if (row["Paper Size"]) metadata.paper_size = row["Paper Size"]
    if (row["Duplex Printing"]) metadata.duplex_printing = row["Duplex Printing"]
    if (row["RAID Support"]) metadata.raid_support = row["RAID Support"]
    if (row["Network Interfaces"]) metadata.network_interfaces = row["Network Interfaces"]
    if (row["Refresh Rate"]) metadata.refresh_rate = row["Refresh Rate"]
    if (row["Panel Type"]) metadata.panel_type = row["Panel Type"]
    if (row["Connectivity Ports"]) metadata.connectivity_ports = row["Connectivity Ports"]
    if (row.Availability) metadata.availability = row.Availability
    if (brand) metadata.brand = brand

    const catNames = ["Gadgets"]
    if (category && catMap[category]) catNames.push(category)

    const isAvailable = row.Availability !== "Out of stock"
    const description = buildGadgetDescription(row, title)

    const pid = addProduct({
      title,
      handle: title,
      subtitle: category || null,
      description,
      weight: row["Weight (lb)"] ? String(row["Weight (lb)"]) : null,
      metadata,
      categoryNames: catNames,
      typeName: "Electronics",
      collectionTitle: "Gadgets & Electronics",
      status: "published",
    })

    // Option: Default (every product needs at least one option for Medusa)
    const optValIdDefault = addOption(pid, "Spec", "Default")

    const vid = addVariant({
      productId: pid,
      title: "Default",
      sku: row["Item ID"] ? String(row["Item ID"]) : null,
      weight: row["Weight (lb)"],
      resellerPrice: row["Reseller Price (₦)"],
      retailPrice: row["Retail Price (₦)"],
      stockQty: row["Stock Quantity"],
    })

    linkVariantOption(vid, optValIdDefault)

    // If color info exists in Form Factor, add as option
    const color = (row["Form Factor"] || "").trim()
    if (color && ["Grey", "Silver", "Black", "White", "Gold", "Blue", "Red", "Pink", "Green"].some(
      (c) => color.toLowerCase().includes(c.toLowerCase())
    )) {
      const colorOptValId = addOption(pid, "Color", color)
      linkVariantOption(vid, colorOptValId)
    }
  }

  // -----------------------------------------------------------------------
  // 2. CCTV CAMERAS
  // -----------------------------------------------------------------------
  const cctvRows = readCCTV(wb)
  for (const row of cctvRows) {
    const brand = (row.NAME || "").trim()
    const model = (row.MODEL || "").trim()
    const title = model ? `${brand} ${model}` : brand
    if (!title) continue

    const metadata = {}
    if (row["CAMERA TYPE"]) metadata.camera_type = row["CAMERA TYPE"]
    if (row["POWER TYPE"]) metadata.power_type = row["POWER TYPE"]
    if (row.CONNECTIVITY) metadata.connectivity = row.CONNECTIVITY
    if (row["STORAGE TYPE"]) metadata.storage_type = row["STORAGE TYPE"]
    if (row.RESOLUTION) metadata.resolution = row.RESOLUTION
    if (row.LENS) metadata.lens = row.LENS
    if (row["USE CASE"]) metadata.use_case = row["USE CASE"]
    if (row["NIGHT VISION"]) metadata.night_vision = row["NIGHT VISION"]
    if (brand) metadata.brand = brand

    const description = buildCCTVDescription(row, title)

    const pid = addProduct({
      title,
      handle: title,
      subtitle: row["CAMERA TYPE"] || "CCTV Camera",
      description,
      metadata,
      categoryNames: ["CCTV Cameras"],
      typeName: "Security",
      collectionTitle: "CCTV & Security",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      resellerPrice: null,
      retailPrice: row.PRICE,
      stockQty: null,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 3. SOLAR PANELS
  // -----------------------------------------------------------------------
  const solarPanels = readSolarPanels(wb)
  for (const row of solarPanels) {
    const title = (row["BRAND AND MODEL"] || "").trim()
    if (!title) continue

    const metadata = {}
    if (row["POWER RATING"]) metadata.power_rating = row["POWER RATING"]
    if (row["OPEN CIRCUIT VOLTAGE"]) metadata.open_circuit_voltage = row["OPEN CIRCUIT VOLTAGE"]
    if (row[" ISC"]) metadata.isc = row[" ISC"]
    if (row.VOLTAGE) metadata.voltage = row.VOLTAGE
    if (row.AMPERE) metadata.ampere = row.AMPERE
    if (row.EFFICIENCY) metadata.efficiency = row.EFFICIENCY
    if (row["TEMPERATURE COEFFICIENT"]) metadata.temp_coefficient = row["TEMPERATURE COEFFICIENT"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row.CERTIFICATION) metadata.certification = row.CERTIFICATION

    const description = buildSolarPanelDescription(row, title)

    const pid = addProduct({
      title: `Solar Panel - ${title}`,
      handle: `solar-panel-${title}`,
      subtitle: row["POWER RATING"] || "Solar Panel",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Solar Energy", "Solar Panels"],
      typeName: "Solar",
      collectionTitle: "Solar Energy",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 4. SOLAR BATTERIES
  // -----------------------------------------------------------------------
  const solarBatteries = readSolarBatteries(wb)
  for (const row of solarBatteries) {
    const title = (row["BRAND AND MODEL"] || "").trim()
    if (!title) continue

    const metadata = {}
    if (row.CAPACITY) metadata.capacity = row.CAPACITY
    if (row["BATTERY TYPE"]) metadata.battery_type = row["BATTERY TYPE"]
    if (row["BATTERY CHEMISTRY"]) metadata.battery_chemistry = row["BATTERY CHEMISTRY"]
    if (row["DEPTH OF DISCHARGE"]) metadata.dod = row["DEPTH OF DISCHARGE"]
    if (row["MAX CHARGE RATE"]) metadata.max_charge_rate = row["MAX CHARGE RATE"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row.CERTIFICATION) metadata.certification = row.CERTIFICATION
    if (row.VOLTAGE) metadata.voltage = row.VOLTAGE

    const description = buildSolarBatteryDescription(row, title)

    const pid = addProduct({
      title: `Solar Battery - ${title}`,
      handle: `solar-battery-${title}`,
      subtitle: row.CAPACITY || "Solar Battery",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Solar Energy", "Solar Batteries"],
      typeName: "Solar",
      collectionTitle: "Solar Energy",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 5. POWER STATIONS
  // -----------------------------------------------------------------------
  const powerStations = readPowerStations(wb)
  for (const row of powerStations) {
    const title = (row.MODEL || "").trim()
    if (!title) continue

    const metadata = {}
    if (row["BATTERY CHEMISTRY"]) metadata.battery_chemistry = row["BATTERY CHEMISTRY"]
    if (row.CAPACITY) metadata.capacity = row.CAPACITY
    if (row["AC  INPUT"]) metadata.ac_input = row["AC  INPUT"]
    if (row["SOLAR INPUT"]) metadata.solar_input = row["SOLAR INPUT"]
    if (row["AC OUTPUT"]) metadata.ac_output = row["AC OUTPUT"]
    if (row["CHARGING OPTIONS"]) metadata.charging_options = row["CHARGING OPTIONS"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row["LIFTING POWER"]) metadata.lifting_power = row["LIFTING POWER"]

    const description = buildPowerStationDescription(row, title)

    const pid = addProduct({
      title: `Power Station - ${title}`,
      handle: `power-station-${title}`,
      subtitle: row.CAPACITY || "Power Station",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Power Solutions", "Power Stations"],
      typeName: "Power",
      collectionTitle: "Power Solutions",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 6. ALL-IN-ONE INVERTER BATTERY
  // -----------------------------------------------------------------------
  const allInOne = readAllInOne(wb)
  for (const row of allInOne) {
    const title = (row["SYSTEM TYPE"] || "").trim()
    if (!title) continue

    const metadata = {}
    if (row["BATTERY CHEMISTRY"]) metadata.battery_chemistry = row["BATTERY CHEMISTRY"]
    if (row.CAPACITY) metadata.capacity = row.CAPACITY
    if (row["NOMINAL VOLTS"]) metadata.nominal_volts = row["NOMINAL VOLTS"]
    if (row.DOD) metadata.dod = row.DOD
    if (row.WARRANTY) metadata.warranty = row.WARRANTY

    const description = buildAllInOneDescription(row, title)

    const pid = addProduct({
      title: `Inverter Battery - ${title}`,
      handle: `inverter-battery-${title}`,
      subtitle: row.CAPACITY || "All-in-one Inverter Battery",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Power Solutions", "All-in-one Inverter Battery"],
      typeName: "Power",
      collectionTitle: "Power Solutions",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  return {
    products,
    variants,
    options,
    optionValues,
    variantOptions,
    priceSets,
    prices,
    inventoryItems,
    inventoryLevels,
    variantPriceSets,
    variantInventoryItems,
    productCategories,
    productSalesChannels,
    productShippingProfiles,
  }
}

// ---------------------------------------------------------------------------
// Description builders
// ---------------------------------------------------------------------------
function buildGadgetDescription(row, title) {
  const parts = [title]
  if (row.Processor) parts.push(`Processor: ${row.Processor}`)
  if (row["RAM (GB)"]) parts.push(`RAM: ${row["RAM (GB)"]}GB`)
  if (row["SSD (GB / TB)"]) parts.push(`SSD: ${row["SSD (GB / TB)"]}`)
  if (row["HDD (GB / TB)"]) parts.push(`HDD: ${row["HDD (GB / TB)"]}`)
  if (row["Graphics Card"]) parts.push(`Graphics: ${row["Graphics Card"]}`)
  if (row['Screen Size "']) parts.push(`Screen: ${row['Screen Size "']}\"`)
  if (row.Resolution) parts.push(`Resolution: ${row.Resolution}`)
  if (row["Operating System"]) parts.push(`OS: ${row["Operating System"]}`)
  return parts.join(". ")
}

function buildCCTVDescription(row, title) {
  const parts = [title]
  if (row["CAMERA TYPE"]) parts.push(`Type: ${row["CAMERA TYPE"]}`)
  if (row.RESOLUTION) parts.push(`Resolution: ${row.RESOLUTION}`)
  if (row.LENS) parts.push(`Lens: ${row.LENS}`)
  if (row["USE CASE"]) parts.push(`Use: ${row["USE CASE"]}`)
  if (row["NIGHT VISION"]) parts.push(`Night Vision: ${row["NIGHT VISION"]}`)
  return parts.join(". ")
}

function buildSolarPanelDescription(row, title) {
  const parts = [`Solar Panel ${title}`]
  if (row["POWER RATING"]) parts.push(`Power: ${row["POWER RATING"]}`)
  if (row.EFFICIENCY) parts.push(`Efficiency: ${row.EFFICIENCY}%`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

function buildSolarBatteryDescription(row, title) {
  const parts = [`Solar Battery ${title}`]
  if (row.CAPACITY) parts.push(`Capacity: ${row.CAPACITY}`)
  if (row["BATTERY CHEMISTRY"]) parts.push(`Chemistry: ${row["BATTERY CHEMISTRY"]}`)
  if (row.VOLTAGE) parts.push(`Voltage: ${row.VOLTAGE}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

function buildPowerStationDescription(row, title) {
  const parts = [`Power Station ${title}`]
  if (row.CAPACITY) parts.push(`Capacity: ${row.CAPACITY}`)
  if (row["AC OUTPUT"]) parts.push(`AC Output: ${row["AC OUTPUT"]}`)
  if (row["CHARGING OPTIONS"]) parts.push(`Charging: ${row["CHARGING OPTIONS"]}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

function buildAllInOneDescription(row, title) {
  const parts = [`All-in-one Inverter Battery ${title}`]
  if (row.CAPACITY) parts.push(`Capacity: ${row.CAPACITY}`)
  if (row["BATTERY CHEMISTRY"]) parts.push(`Chemistry: ${row["BATTERY CHEMISTRY"]}`)
  if (row["NOMINAL VOLTS"]) parts.push(`Voltage: ${row["NOMINAL VOLTS"]}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

// ---------------------------------------------------------------------------
// Database insertion
// ---------------------------------------------------------------------------
async function seedDatabase(data, categories, types, collections) {
  const pool = new pg.Pool({ connectionString: DB_URL })
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    // 1. Create stock location if not exists
    await client.query(`
      INSERT INTO stock_location (id, name, created_at, updated_at)
      VALUES ('sloc_ceedmart_default', 'Ceedmart Warehouse', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `)
    console.log("  Stock location ready")

    // 2. Product types
    for (const t of types) {
      await client.query(
        `INSERT INTO product_type (id, value, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [t.id, t.value]
      )
    }
    console.log(`  ${types.length} product types created`)

    // 3. Product collections
    for (const c of collections) {
      await client.query(
        `INSERT INTO product_collection (id, title, handle, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [c.id, c.title, c.handle]
      )
    }
    console.log(`  ${collections.length} collections created`)

    // 4. Categories
    for (const cat of categories) {
      await client.query(
        `INSERT INTO product_category (id, name, handle, mpath, is_active, is_internal, rank, parent_category_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [cat.id, cat.name, cat.handle, cat.mpath, cat.is_active, cat.is_internal, cat.rank, cat.parent_category_id]
      )
    }
    console.log(`  ${categories.length} categories created`)

    // 5. Products
    for (const p of data.products) {
      await client.query(
        `INSERT INTO product (id, title, handle, subtitle, description, is_giftcard, status, weight, metadata, collection_id, type_id, discountable, origin_country, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [p.id, p.title, p.handle, p.subtitle, p.description, p.is_giftcard, p.status, p.weight, p.metadata, p.collection_id, p.type_id, p.discountable, p.origin_country]
      )
    }
    console.log(`  ${data.products.length} products created`)

    // 6. Product options
    for (const o of data.options) {
      await client.query(
        `INSERT INTO product_option (id, title, product_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [o.id, o.title, o.product_id]
      )
    }
    console.log(`  ${data.options.length} options created`)

    // 7. Option values
    for (const ov of data.optionValues) {
      await client.query(
        `INSERT INTO product_option_value (id, value, option_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [ov.id, ov.value, ov.option_id]
      )
    }
    console.log(`  ${data.optionValues.length} option values created`)

    // 8. Variants
    for (const v of data.variants) {
      await client.query(
        `INSERT INTO product_variant (id, title, sku, product_id, weight, manage_inventory, allow_backorder, variant_rank, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [v.id, v.title, v.sku, v.product_id, v.weight, v.manage_inventory, v.allow_backorder, v.variant_rank, v.metadata]
      )
    }
    console.log(`  ${data.variants.length} variants created`)

    // 9. Variant-option links
    for (const vo of data.variantOptions) {
      await client.query(
        `INSERT INTO product_variant_option (variant_id, option_value_id) VALUES ($1, $2)`,
        [vo.variant_id, vo.option_value_id]
      )
    }
    console.log(`  ${data.variantOptions.length} variant-option links created`)

    // 10. Price sets
    for (const ps of data.priceSets) {
      await client.query(
        `INSERT INTO price_set (id, created_at, updated_at) VALUES ($1, NOW(), NOW())`,
        [ps.id]
      )
    }
    console.log(`  ${data.priceSets.length} price sets created`)

    // 11. Prices
    for (const pr of data.prices) {
      await client.query(
        `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [pr.id, pr.price_set_id, pr.currency_code, pr.amount, pr.raw_amount, pr.title]
      )
    }
    console.log(`  ${data.prices.length} prices created`)

    // 12. Variant-price-set links
    for (const vps of data.variantPriceSets) {
      await client.query(
        `INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [vps.id, vps.variant_id, vps.price_set_id]
      )
    }
    console.log(`  ${data.variantPriceSets.length} variant-price links created`)

    // 13. Inventory items
    for (const ii of data.inventoryItems) {
      await client.query(
        `INSERT INTO inventory_item (id, sku, title, requires_shipping, weight, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [ii.id, ii.sku, ii.title, ii.requires_shipping, ii.weight]
      )
    }
    console.log(`  ${data.inventoryItems.length} inventory items created`)

    // 14. Inventory levels
    for (const il of data.inventoryLevels) {
      await client.query(
        `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, raw_stocked_quantity, raw_reserved_quantity, raw_incoming_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [il.id, il.inventory_item_id, il.location_id, il.stocked_quantity, il.reserved_quantity, il.incoming_quantity, il.raw_stocked_quantity, il.raw_reserved_quantity, il.raw_incoming_quantity]
      )
    }
    console.log(`  ${data.inventoryLevels.length} inventory levels created`)

    // 15. Variant-inventory links
    for (const vii of data.variantInventoryItems) {
      await client.query(
        `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [vii.id, vii.variant_id, vii.inventory_item_id, vii.required_quantity]
      )
    }
    console.log(`  ${data.variantInventoryItems.length} variant-inventory links created`)

    // 16. Product-category links
    for (const pc of data.productCategories) {
      await client.query(
        `INSERT INTO product_category_product (product_id, product_category_id) VALUES ($1, $2)`,
        [pc.product_id, pc.product_category_id]
      )
    }
    console.log(`  ${data.productCategories.length} product-category links created`)

    // 17. Product-sales-channel links
    for (const psc of data.productSalesChannels) {
      await client.query(
        `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [psc.id, psc.product_id, psc.sales_channel_id]
      )
    }
    console.log(`  ${data.productSalesChannels.length} product-sales-channel links created`)

    // 18. Product-shipping-profile links
    for (const psp of data.productShippingProfiles) {
      await client.query(
        `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [psp.id, psp.product_id, psp.shipping_profile_id]
      )
    }
    console.log(`  ${data.productShippingProfiles.length} product-shipping links created`)

    await client.query("COMMIT")
    console.log("\n  Transaction committed successfully!")
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("\n  ROLLBACK - Error:", err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Ceedmart Product Seeder ===\n")
  console.log("Reading spreadsheet...")
  const wb = readWorkbook()

  console.log("Building categories...")
  const gadgets = readGadgets(wb)
  const { categories, catMap } = buildCategories(gadgets)

  console.log("Building types and collections...")
  const { types, typeMap, collections, colMap } = buildTypesAndCollections()

  console.log("Building products from all 6 tabs...")
  const data = buildProducts(wb, catMap, typeMap, colMap)

  console.log(`\n--- Summary ---`)
  console.log(`  Categories:        ${categories.length}`)
  console.log(`  Product Types:     ${types.length}`)
  console.log(`  Collections:       ${collections.length}`)
  console.log(`  Products:          ${data.products.length}`)
  console.log(`  Variants:          ${data.variants.length}`)
  console.log(`  Options:           ${data.options.length}`)
  console.log(`  Option Values:     ${data.optionValues.length}`)
  console.log(`  Price Sets:        ${data.priceSets.length}`)
  console.log(`  Prices:            ${data.prices.length}`)
  console.log(`  Inventory Items:   ${data.inventoryItems.length}`)
  console.log(`  Inventory Levels:  ${data.inventoryLevels.length}`)
  console.log(`  Category Links:    ${data.productCategories.length}`)
  console.log(`  Sales Ch. Links:   ${data.productSalesChannels.length}`)
  console.log(`  Shipping Links:    ${data.productShippingProfiles.length}`)

  console.log(`\nSeeding database...`)
  await seedDatabase(data, categories, types, collections)

  console.log("\n=== Seeding Complete ===")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
