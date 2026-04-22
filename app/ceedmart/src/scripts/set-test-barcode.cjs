/**
 * Set a test barcode on one product variant so the POS barcode scanner
 * can be exercised against `/pos/product-by-barcode/:sales_channel_id/:barcode`.
 *
 * Usage:
 *   node app/ceedmart/src/scripts/set-test-barcode.cjs [barcode]
 *
 * Defaults to 714084852829 when no argument is given.
 */

const pg = require("pg")

const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/ceedmart"
const BARCODE = process.argv[2] || "714084852829"

async function main() {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()

  await client.query("BEGIN")

  try {
    await client.query(
      `UPDATE product_variant SET barcode = NULL, updated_at = NOW()
       WHERE barcode = $1 AND deleted_at IS NULL`,
      [BARCODE]
    )

    const { rows } = await client.query(`
      SELECT pv.id  AS variant_id,
             pv.title AS variant_title,
             pv.sku,
             p.id   AS product_id,
             p.title AS product_title,
             sc.id  AS sales_channel_id,
             sc.name AS sales_channel_name
      FROM product_variant pv
      JOIN product p
        ON p.id = pv.product_id AND p.deleted_at IS NULL
      JOIN product_sales_channel psc
        ON psc.product_id = p.id
      JOIN sales_channel sc
        ON sc.id = psc.sales_channel_id AND sc.deleted_at IS NULL
      WHERE p.status = 'published'
        AND pv.deleted_at IS NULL
      ORDER BY p.created_at ASC, pv.variant_rank ASC
      LIMIT 1
    `)

    if (!rows.length) {
      throw new Error(
        "No published product linked to a sales channel has any variants."
      )
    }

    const row = rows[0]

    await client.query(
      `UPDATE product_variant SET barcode = $1, updated_at = NOW() WHERE id = $2`,
      [BARCODE, row.variant_id]
    )

    await client.query("COMMIT")

    console.log("\nBarcode set on test variant\n")
    console.log(`  Barcode       : ${BARCODE}`)
    console.log(`  Product       : ${row.product_title}`)
    console.log(`  Product id    : ${row.product_id}`)
    console.log(`  Variant       : ${row.variant_title}${row.sku ? `  [sku ${row.sku}]` : ""}`)
    console.log(`  Variant id    : ${row.variant_id}`)
    console.log(`  Sales channel : ${row.sales_channel_name} (${row.sales_channel_id})`)
    console.log("")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
