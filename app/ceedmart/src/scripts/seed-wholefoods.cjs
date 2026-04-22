/**
 * Ceedmart Whole Foods Seed Script
 *
 * Reads "Frodor_food_stuffs_items.xlsx" and populates the Medusa DB
 * with Whole Foods collection, categories, products, variants, pricing, and inventory.
 *
 * Usage:
 *   NODE_PATH=/tmp/node_modules node app/ceedmart/src/scripts/seed-wholefoods.cjs
 */

const pg = require("pg")
const XLSX = require("xlsx")
const crypto = require("crypto")
const path = require("path")

const XLSX_PATH = path.resolve(__dirname, "../../../../Frodor_food_stuffs_items.xlsx")
const DB_URL = process.env.DATABASE_URL || "postgres://localhost/ceedmart"

// Known IDs
const SALES_CHANNEL_ID = "sc_01KMMZDX2HH3QGYABSKFJHBVP5"
const SHIPPING_PROFILE_ID = "sp_01KMMZDKDJWJYJ0X1DF54789K6"
const CURRENCY_CODE = "ngn"
const STOCK_LOCATION_ID = "sloc_ceedmart_default"

function uid() {
  return crypto.randomBytes(12).toString("base64url").replace(/[_-]/g, "x")
}

function slugify(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 100)
}

function parsePrice(val) {
  if (!val) return null
  if (typeof val === "number") return Math.round(val)
  const cleaned = String(val).replace(/[^0-9.]/g, "")
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : Math.round(n)
}

// ---------------------------------------------------------------------------
// Read spreadsheet
// ---------------------------------------------------------------------------
function readWorkbook() {
  return XLSX.readFile(XLSX_PATH)
}

function readStaples(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets["Frodor staples"], { defval: null })
    .filter((r) => r["FOOD ITEMS"])
}

function readRestock(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets["Restock starter"], { defval: null })
    .filter((r) => r["Items "])
}

function readPlatter1(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets["Plater 1 (Freshfamily combo)"], { defval: null })
    .filter((r) => r[" Items"])
}

function readPlatter2(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets["plater 2 (healthytreats combo)"], { defval: null })
    .filter((r) => r[" Items "])
}

// ---------------------------------------------------------------------------
// Categorize staple items
// ---------------------------------------------------------------------------
function categorizeItem(name) {
  const n = (name || "").toLowerCase()
  if (["garri", "rice", "beans", "semovita", "indomie", "spagetti", "spaghetti"].some((k) => n.includes(k)))
    return "Grains & Staples"
  if (["palm oil", "groundnut oil"].some((k) => n.includes(k)))
    return "Oils & Condiments"
  if (["egg", "snail", "beef", "kpomo", "chicken", "turkey", "fish", "stock fish", "frozen"].some((k) => n.includes(k)))
    return "Proteins & Seafood"
  if (["plaintain", "plantain", "potatoes", "onion", "tomato", "vegetable", "pepper"].some((k) => n.includes(k)))
    return "Fresh Produce"
  if (["egusi", "ogbono", "crayfish", "spice", "spiecies", "tomatoe pase"].some((k) => n.includes(k)))
    return "Soups & Spices"
  return "Other Foods"
}

// ---------------------------------------------------------------------------
// Build platter description
// ---------------------------------------------------------------------------
function buildPlatterDescription(items, fields) {
  const lines = items.map((r) => {
    const name = (r[fields.name] || "").trim()
    const qty = r[fields.qty] || ""
    const grams = r[fields.grams] || ""
    const price = r[fields.price] || ""
    let line = `• ${name}`
    if (qty) line += ` — ${qty}`
    if (grams) line += ` (${grams}g)`
    return line
  })
  return lines.join("\n")
}

function platterTotalPrice(items, priceField) {
  return items.reduce((sum, r) => sum + (parsePrice(r[priceField]) || 0), 0)
}

// ---------------------------------------------------------------------------
// Main seed logic
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Ceedmart Whole Foods Seeder ===\n")

  const wb = readWorkbook()
  const staples = readStaples(wb)
  const restock = readRestock(wb)
  const platter1Items = readPlatter1(wb)
  const platter2Items = readPlatter2(wb)

  console.log(`Staples: ${staples.length}, Restock: ${restock.length}, Platter1: ${platter1Items.length}, Platter2: ${platter2Items.length}`)

  const pool = new pg.Pool({ connectionString: DB_URL })
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    // 1. Product Type
    const typeId = `ptyp_${uid()}`
    await client.query(
      `INSERT INTO product_type (id, value, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [typeId, "Food & Groceries"]
    )
    // Check if type already exists
    const existingType = await client.query(`SELECT id FROM product_type WHERE value = 'Food & Groceries'`)
    const finalTypeId = existingType.rows[0]?.id || typeId
    console.log("  Product type: Food & Groceries")

    // 2. Collection
    const colId = `pcol_${uid()}`
    await client.query(
      `INSERT INTO product_collection (id, title, handle, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [colId, "Whole Foods", "whole-foods"]
    )
    const existingCol = await client.query(`SELECT id FROM product_collection WHERE handle = 'whole-foods'`)
    const finalColId = existingCol.rows[0]?.id || colId
    console.log("  Collection: Whole Foods")

    // 3. Categories
    const parentCatId = `pcat_${uid()}`
    await client.query(
      `INSERT INTO product_category (id, name, handle, mpath, is_active, is_internal, rank, parent_category_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, false, 20, NULL, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [parentCatId, "Whole Foods", "whole-foods", `${parentCatId}.`]
    )
    const existingParentCat = await client.query(`SELECT id FROM product_category WHERE handle = 'whole-foods' AND deleted_at IS NULL`)
    const finalParentCatId = existingParentCat.rows[0]?.id || parentCatId

    const subCats = [
      "Grains & Staples",
      "Oils & Condiments",
      "Proteins & Seafood",
      "Fresh Produce",
      "Soups & Spices",
      "Combos & Platters",
      "Other Foods",
    ]

    const catMap = {}
    catMap["Whole Foods"] = finalParentCatId

    for (let i = 0; i < subCats.length; i++) {
      const name = subCats[i]
      const handle = slugify(name)
      const id = `pcat_${uid()}`
      await client.query(
        `INSERT INTO product_category (id, name, handle, mpath, is_active, is_internal, rank, parent_category_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, false, $5, $6, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, name, handle, `${finalParentCatId}.${id}.`, 21 + i, finalParentCatId]
      )
      const existing = await client.query(`SELECT id FROM product_category WHERE handle = $1 AND deleted_at IS NULL`, [handle])
      catMap[name] = existing.rows[0]?.id || id
    }
    console.log(`  ${Object.keys(catMap).length} categories created`)

    // Track handles
    const usedHandles = new Set()
    function uniqueHandle(base) {
      let h = slugify(base) || "product"
      let candidate = h
      let counter = 1
      while (usedHandles.has(candidate)) candidate = `${h}-${counter++}`
      usedHandles.add(candidate)
      return candidate
    }

    let productCount = 0
    let priceCount = 0
    let inventoryCount = 0

    // Helper to create a full product
    async function createProduct({ title, subtitle, description, categories, retailPrice, resellerPrice, measurement, weight }) {
      const pid = `prod_${uid()}`
      const vid = `variant_${uid()}`
      const handle = uniqueHandle(title)
      const optId = `opt_${uid()}`
      const optValId = `optval_${uid()}`
      const psid = `priceset_${uid()}`

      // Product
      await client.query(
        `INSERT INTO product (id, title, handle, subtitle, description, is_giftcard, status, metadata, collection_id, type_id, discountable, origin_country, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, 'published', $6, $7, $8, true, 'NG', NOW(), NOW())`,
        [pid, title, handle, subtitle || null, description || null, measurement ? JSON.stringify({ measurement }) : null, finalColId, finalTypeId]
      )

      // Option + value
      await client.query(`INSERT INTO product_option (id, title, product_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`, [optId, "Unit", pid])
      await client.query(`INSERT INTO product_option_value (id, value, option_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`, [optValId, measurement || "Default", optId])

      // Variant
      await client.query(
        `INSERT INTO product_variant (id, title, product_id, manage_inventory, allow_backorder, variant_rank, created_at, updated_at)
         VALUES ($1, $2, $3, true, false, 0, NOW(), NOW())`,
        [vid, title, pid]
      )
      await client.query(`INSERT INTO product_variant_option (variant_id, option_value_id) VALUES ($1, $2)`, [vid, optValId])

      // Price set + prices
      await client.query(`INSERT INTO price_set (id, created_at, updated_at) VALUES ($1, NOW(), NOW())`, [psid])
      await client.query(
        `INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [`link_${uid()}`, vid, psid]
      )

      if (retailPrice) {
        await client.query(
          `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, title, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [`price_${uid()}`, psid, CURRENCY_CODE, retailPrice, JSON.stringify({ value: String(retailPrice), precision: 20 }), "Retail"]
        )
        priceCount++
      }

      if (resellerPrice && resellerPrice !== retailPrice) {
        await client.query(
          `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, title, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [`price_${uid()}`, psid, CURRENCY_CODE, resellerPrice, JSON.stringify({ value: String(resellerPrice), precision: 20 }), "Reseller"]
        )
        priceCount++
      }

      // Inventory
      const iiid = `iitem_${uid()}`
      const ilid = `ilev_${uid()}`
      const qty = 10 + Math.floor(Math.random() * 41) // 10-50
      await client.query(
        `INSERT INTO inventory_item (id, title, requires_shipping, created_at, updated_at) VALUES ($1, $2, true, NOW(), NOW())`,
        [iiid, title]
      )
      await client.query(
        `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, raw_stocked_quantity, raw_reserved_quantity, raw_incoming_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $6, NOW(), NOW())`,
        [ilid, iiid, STOCK_LOCATION_ID, qty, JSON.stringify({ value: String(qty), precision: 20 }), JSON.stringify({ value: "0", precision: 20 })]
      )
      await client.query(
        `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, 1, NOW(), NOW())`,
        [`link_${uid()}`, vid, iiid]
      )
      inventoryCount++

      // Category links
      for (const catName of categories) {
        if (catMap[catName]) {
          await client.query(
            `INSERT INTO product_category_product (product_id, product_category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [pid, catMap[catName]]
          )
        }
      }

      // Sales channel + shipping profile
      await client.query(
        `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [`link_${uid()}`, pid, SALES_CHANNEL_ID]
      )
      await client.query(
        `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [`link_${uid()}`, pid, SHIPPING_PROFILE_ID]
      )

      productCount++
      return pid
    }

    // ----- TAB 1: Frodor Staples (individual products) -----
    console.log("\n  Seeding Frodor Staples...")
    for (const row of staples) {
      const name = (row["FOOD ITEMS"] || "").trim()
      const category = categorizeItem(name)
      const variety = (row["CATEGORIES OF FOOD "] || "").trim()
      const measurement = (row["Measurement"] || "").trim()
      const supplierPrice = parsePrice(row["SUPPLERS PRICE"])
      const marketPrice = parsePrice(row["MARKET PRICE"])
      const sellingPrice = parsePrice(row["SELLING PRICE"])

      const retailPrice = sellingPrice || marketPrice || supplierPrice
      const resellerPrice = supplierPrice

      const subtitle = variety && variety !== name ? variety : category
      const description = [
        name,
        variety ? `Variety: ${variety}` : null,
        measurement ? `Unit: ${measurement}` : null,
      ].filter(Boolean).join(". ")

      await createProduct({
        title: variety && variety !== name ? `${name} — ${variety}` : name,
        subtitle,
        description,
        categories: ["Whole Foods", category],
        retailPrice,
        resellerPrice,
        measurement,
      })
    }

    // ----- TAB 2: Restock Starter (retail portions) -----
    console.log("  Seeding Restock Starter items...")
    for (const row of restock) {
      const name = (row["Items "] || "").trim()
      const qty = (row["Quanty"] || "").trim()
      const sellingPrice = parsePrice(row["Selling price"])
      const category = categorizeItem(name)
      const measurement = qty || null

      await createProduct({
        title: `${name} (Restock)`,
        subtitle: "Restock Starter",
        description: `${name}${qty ? ` — ${qty}` : ""}. Quick restock portion.`,
        categories: ["Whole Foods", category],
        retailPrice: sellingPrice,
        resellerPrice: null,
        measurement,
      })
    }

    // ----- TAB 3: Platter 1 — Fresh Family Combo -----
    console.log("  Seeding Fresh Family Combo platter...")
    const platter1Desc = buildPlatterDescription(platter1Items, { name: " Items", qty: "Quantity", grams: "measurement (grams)", price: "Selling price" })
    const platter1Total = platterTotalPrice(platter1Items, "Selling price")

    await createProduct({
      title: "Fresh Family Combo Platter",
      subtitle: "Combo Platter",
      description: `Complete family meal prep combo with 10 items:\n\n${platter1Desc}\n\nPerfect for weekly family cooking needs.`,
      categories: ["Whole Foods", "Combos & Platters"],
      retailPrice: platter1Total,
      resellerPrice: null,
      measurement: "1 platter",
    })

    // ----- TAB 4: Platter 2 — Healthy Treats Combo -----
    console.log("  Seeding Healthy Treats Combo platter...")
    const platter2Desc = buildPlatterDescription(platter2Items, { name: " Items ", qty: "Quantity", grams: "measurement (grams)", price: "Selling price" })
    const platter2Total = platterTotalPrice(platter2Items, "Selling price")

    await createProduct({
      title: "Healthy Treats Combo Platter",
      subtitle: "Combo Platter",
      description: `Healthy cooking essentials combo with 9 items:\n\n${platter2Desc}\n\nEverything you need for healthy meals.`,
      categories: ["Whole Foods", "Combos & Platters"],
      retailPrice: platter2Total,
      resellerPrice: null,
      measurement: "1 platter",
    })

    await client.query("COMMIT")

    console.log(`\n--- Summary ---`)
    console.log(`  Products:  ${productCount}`)
    console.log(`  Prices:    ${priceCount}`)
    console.log(`  Inventory: ${inventoryCount}`)
    console.log(`\n=== Whole Foods Seeding Complete ===`)

  } catch (err) {
    await client.query("ROLLBACK")
    console.error("\n  ROLLBACK - Error:", err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
