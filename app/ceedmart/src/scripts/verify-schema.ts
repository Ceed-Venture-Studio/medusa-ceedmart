import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Prove every model can actually write a row.
//
// ── Why this exists ─────────────────────────────────────────────────────
// Three schema bugs shipped past typecheck, 257 unit tests and a full
// `medusa build`, because none of those ever writes to the database:
//
//   • `model.bigNumber()` stores its precise value in a companion column
//     named `raw_<field>`. Several migrations created `<field>_raw`, so the
//     first insert died on a column that did not exist. commission_entry
//     had this from the day M3 shipped — the subscriber caught and logged
//     the error, so partner commission silently accrued nothing for months.
//
//   • The ORM derives a table name from the model name, so
//     `model.define("ComponentCategory")` looks for `component_category`.
//     Five models pointed at tables the migrations had prefixed differently.
//
//   • A column present on the model but absent from the migration is
//     invisible until something reads or writes it.
//
// Every one is caught by inserting a single row. That is all this does:
// for each model, write the smallest valid row, read it back, delete it.
// It goes through the module SERVICES rather than raw SQL, so the mapping
// under test is the same one the application uses.
//
// Run it against a scratch database — `yarn verify:schema` handles that.

type Check = {
  /** Registration key from medusa-config. */
  module: string
  /** Model name, for the report. */
  model: string
  /** MedusaService generates create/list/delete per model. */
  create: string
  list: string
  del: string
  /** Smallest row the model considers valid. */
  row: Record<string, unknown>
  /** Fields to read back and compare — the ones most likely to be
   *  mis-mapped. bigNumber fields belong here: they are the ones with a
   *  companion raw_ column. */
  verify?: string[]
}

const now = new Date()

// Foreign keys are plain text columns by design — these modules deliberately
// do not link to Medusa entities, so an audit row outlives the thing it
// describes. That means placeholder ids are fine here.
const REF = "vfy_00000000"

const CHECKS: Check[] = [
  // ── Phase 0 ─────────────────────────────────────────────────────────
  {
    module: "audit", model: "AuditEvent",
    create: "createAuditEvents", list: "listAuditEvents", del: "deleteAuditEvents",
    row: { entity_type: "verify", entity_id: REF, action: "transition", from_value: "a", to_value: "b" },
    verify: ["entity_type", "action", "to_value"],
  },
  {
    module: "terms", model: "TermsDocument",
    create: "createTermsDocuments", list: "listTermsDocuments", del: "deleteTermsDocuments",
    row: { slug: "verify_doc", name: "Verify" },
    verify: ["slug"],
  },
  {
    module: "terms", model: "TermsVersion",
    create: "createTermsVersions", list: "listTermsVersions", del: "deleteTermsVersions",
    row: { document_id: REF, version: 1, body: "<p>verify</p>", is_current: false },
    verify: ["version", "body"],
  },
  {
    module: "terms", model: "TermsAcceptance",
    create: "createTermsAcceptances", list: "listTermsAcceptances", del: "deleteTermsAcceptances",
    row: { version_id: REF, document_slug: "verify", entity_type: "order", entity_id: REF, accepted_at: now },
    verify: ["document_slug", "entity_type"],
  },
  {
    module: "listing_policy", model: "ListingPolicy",
    create: "createListingPolicies", list: "listListingPolicies", del: "deleteListingPolicies",
    row: { variant_id: REF, commerce_type: "preorder", is_active: true, config: { estimate_days: 14 } },
    verify: ["commerce_type", "is_active"],
  },
  {
    module: "job_claim", model: "JobClaim",
    create: "createJobClaims", list: "listJobClaims", del: "deleteJobClaims",
    row: { scope: "verify", work_id: REF, claimed_at: now, expires_at: new Date(now.getTime() + 60000) },
    verify: ["scope", "work_id"],
  },
  {
    module: "notification_log", model: "NotificationLog",
    create: "createNotificationLogs", list: "listNotificationLogs", del: "deleteNotificationLogs",
    row: { channel: "email", template: "verify", recipient: "a@b.c", status: "sent", attempt: 1 },
    verify: ["channel", "status", "attempt"],
  },

  // ── Phase 1 — pre-order ─────────────────────────────────────────────
  {
    module: "preorder", model: "SourceSupplier",
    create: "createSourceSuppliers", list: "listSourceSuppliers", del: "deleteSourceSuppliers",
    row: { name: "Verify Supplier", country_code: "us", is_active: true },
    verify: ["name", "country_code"],
  },
  {
    module: "preorder", model: "PreorderOffer",
    create: "createPreorderOffers", list: "listPreorderOffers", del: "deletePreorderOffers",
    // locked_price is a bigNumber — the exact shape that broke.
    row: { variant_id: REF, locked_price: 46_800_000, currency_code: "ngn", procurement_days: 3, transit_days: 7, customs_days: 4, condition: "new" },
    verify: ["locked_price", "currency_code", "transit_days"],
  },
  {
    module: "preorder", model: "PreorderOrder",
    create: "createPreorderOrders", list: "listPreorderOrders", del: "deletePreorderOrders",
    row: { order_id: REF, offer_id: REF, quantity: 1, unit_price: 46_800_000, currency_code: "ngn", status: "paid" },
    verify: ["unit_price", "status"],
  },
  {
    module: "preorder", model: "PreorderMilestone",
    create: "createPreorderMilestones", list: "listPreorderMilestones", del: "deletePreorderMilestones",
    row: { preorder_order_id: REF, status: "paid", occurred_at: now },
    verify: ["status"],
  },
  {
    module: "preorder", model: "CustomerApproval",
    create: "createCustomerApprovals", list: "listCustomerApprovals", del: "deleteCustomerApprovals",
    row: { preorder_order_id: REF, kind: "price_increase", description: "verify", status: "pending", requested_at: now },
    verify: ["kind", "status"],
  },

  // ── Phase 2 — builds ────────────────────────────────────────────────
  {
    module: "build", model: "BuildRequest",
    create: "createBuildRequests", list: "listBuildRequests", del: "deleteBuildRequests",
    row: { reference: "VFY-AAAAAA", customer_name: "Verify", customer_email: "a@b.c", build_type: "desktop", intended_use: "verify", budget_min: 50_000_000, budget_max: 90_000_000, status: "submitted" },
    verify: ["reference", "budget_min", "budget_max"],
  },
  {
    module: "build", model: "BuildQuote",
    create: "createBuildQuotes", list: "listBuildQuotes", del: "deleteBuildQuotes",
    row: { request_id: REF, reference: "VFQ-AAAAAA", status: "draft", version_count: 0 },
    verify: ["reference", "status"],
  },
  {
    module: "build", model: "BuildQuoteVersion",
    create: "createBuildQuoteVersions", list: "listBuildQuoteVersions", del: "deleteBuildQuoteVersions",
    row: { quote_id: REF, version: 1, line_items: [{ label: "Part", quantity: 1, unit_price: 100 }], subtotal: 100, total: 100, currency_code: "ngn", valid_until: new Date(now.getTime() + 86400000) },
    verify: ["version", "subtotal", "total"],
  },
  {
    module: "build", model: "BuildOrder",
    create: "createBuildOrders", list: "listBuildOrders", del: "deleteBuildOrders",
    row: { request_id: REF, quote_id: REF, quote_version_id: REF, reference: "VFB-AAAAAA", configuration_snapshot: { line_items: [] }, total: 100, currency_code: "ngn", status: "quote_accepted" },
    verify: ["reference", "total"],
  },
  {
    module: "build", model: "BuildMilestone",
    create: "createBuildMilestones", list: "listBuildMilestones", del: "deleteBuildMilestones",
    row: { build_order_id: REF, status: "paid", occurred_at: now },
    verify: ["status"],
  },
  {
    module: "build", model: "QaCheck",
    create: "createQaChecks", list: "listQaChecks", del: "deleteQaChecks",
    // Model name QaCheck vs table build_qa_check — the mismatch class.
    row: { build_order_id: REF, code: "verify", label: "Verify", is_required: true, result: "pending" },
    verify: ["code", "result", "is_required"],
  },

  // ── Phase 3 — build catalogue ───────────────────────────────────────
  {
    module: "build_catalog", model: "BuildType",
    create: "createBuildTypes", list: "listBuildTypes", del: "deleteBuildTypes",
    row: { code: "verify_type", label: "Verify", is_active: true },
    verify: ["code", "label"],
  },
  {
    module: "build_catalog", model: "ComponentCategory",
    create: "createComponentCategories", list: "listComponentCategories", del: "deleteComponentCategories",
    row: { code: "verify_cat", label: "Verify", build_types: ["desktop"], attribute_schema: [{ key: "socket", label: "Socket", type: "text" }], is_required: true },
    verify: ["code", "build_types", "attribute_schema"],
  },
  {
    module: "build_catalog", model: "ComponentOption",
    create: "createComponentOptions", list: "listComponentOptions", del: "deleteComponentOptions",
    row: { category_id: REF, label: "Verify Part", indicative_price: 1_000_000, attributes: { socket: "AM5" }, is_active: true },
    verify: ["label", "indicative_price", "attributes"],
  },
  {
    module: "build_catalog", model: "CompatibilityRule",
    create: "createCompatibilityRules", list: "listCompatibilityRules", del: "deleteCompatibilityRules",
    row: { code: "verify_rule", left_category: "cpu", left_attribute: "socket", right_category: "motherboard", right_attribute: "socket", operator: "equals", severity: "blocking", message: "verify" },
    verify: ["code", "operator", "severity"],
  },
  {
    module: "build_catalog", model: "BuildConfiguration",
    create: "createBuildConfigurations", list: "listBuildConfigurations", del: "deleteBuildConfigurations",
    row: { reference: "VFC-AAAAAA", build_type: "desktop", selections: [{ category_code: "cpu", option_id: REF }], estimated_total: 1_000_000 },
    verify: ["reference", "estimated_total", "selections"],
  },

  // ── Phase 4 — auctions ──────────────────────────────────────────────
  {
    module: "auction", model: "Auction",
    create: "createAuctions", list: "listAuctions", del: "deleteAuctions",
    // Six bigNumber columns — the densest concentration of the raw_ bug.
    row: { reference: "VFA-AAAAAA", title: "Verify Lot", starts_at: now, ends_at: new Date(now.getTime() + 3600000), starting_price: 10_000_000, min_increment: 500_000, reserve_price: 13_000_000, buy_now_price: 30_000_000, deposit_amount: 1_000_000, currency_code: "ngn", condition: "used", status: "draft" },
    verify: ["reference", "starting_price", "min_increment", "reserve_price", "buy_now_price"],
  },
  {
    module: "auction", model: "Bid",
    create: "createBids", list: "listBids", del: "deleteBids",
    row: { auction_id: REF, sequence: 1, bidder_id: REF, bidder_handle: "Bidder ••••0001", amount: 10_000_000, currency_code: "ngn", placed_at: now, kind: "bid" },
    verify: ["sequence", "amount", "bidder_handle"],
  },
  {
    module: "auction", model: "BidderEligibility",
    create: "createBidderEligibilities", list: "listBidderEligibilities", del: "deleteBidderEligibilities",
    row: { customer_id: REF, email: "a@b.c", phone: "+2348012345678", is_barred: false, default_count: 0 },
    verify: ["customer_id", "phone", "default_count"],
  },
  {
    module: "auction", model: "AuctionResult",
    create: "createAuctionResults", list: "listAuctionResults", del: "deleteAuctionResults",
    row: { auction_id: REF, winning_amount: 14_000_000, currency_code: "ngn", closed_at: now, reserve_met: true, bid_count: 3, unique_bidders: 2 },
    verify: ["winning_amount", "reserve_met", "unique_bidders"],
  },
  {
    module: "auction", model: "WinnerOffer",
    create: "createWinnerOffers", list: "listWinnerOffers", del: "deleteWinnerOffers",
    row: { auction_id: REF, bidder_id: REF, amount: 14_000_000, currency_code: "ngn", rank: 1, offered_at: now, expires_at: new Date(now.getTime() + 86400000), status: "pending" },
    verify: ["amount", "rank", "status"],
  },
  {
    module: "auction", model: "BidderDeposit",
    create: "createBidderDeposits", list: "listBidderDeposits", del: "deleteBidderDeposits",
    row: { auction_id: REF, bidder_id: REF, amount: 1_000_000, currency_code: "ngn", status: "authorized", authorized_at: now },
    verify: ["amount", "status"],
  },
  {
    module: "auction", model: "AuctionDispute",
    create: "createAuctionDisputes", list: "listAuctionDisputes", del: "deleteAuctionDisputes",
    row: { auction_id: REF, kind: "payment", description: "verify", status: "open" },
    verify: ["kind", "status"],
  },

  // ── Pre-existing modules ────────────────────────────────────────────
  // Included deliberately: commission_entry carried the raw_ bug from the
  // day M3 shipped, and nothing in the build ever noticed.
  {
    module: "commission_entry", model: "CommissionEntry",
    create: "createCommissionEntries", list: "listCommissionEntries", del: "deleteCommissionEntries",
    row: { partner_id: REF, partner_code: "VFY1", order_id: REF, eligible_amount: 10_000_000, currency_code: "ngn", commission_rate: 0.07, commission_amount: 700_000, status: "pending" },
    verify: ["eligible_amount", "commission_amount", "commission_rate"],
  },
  {
    module: "partner", model: "Partner",
    create: "createPartners", list: "listPartners", del: "deletePartners",
    row: { code: "VFY2", name: "Verify Partner", status: "active" },
    verify: ["code", "name"],
  },
  {
    module: "solar", model: "SolarQuote",
    create: "createSolarQuotes", list: "listSolarQuotes", del: "deleteSolarQuotes",
    row: { selected_tier: "recommended", selected_bundle: {}, customer_name: "Verify", customer_email: "a@b.c", status: "new" },
    verify: ["selected_tier", "status"],
  },
  {
    module: "solar", model: "SolarCalculation",
    create: "createSolarCalculations", list: "listSolarCalculations", del: "deleteSolarCalculations",
    row: { appliances: [{ name: "Fan", watts: 60, hours: 6 }], total_load_w: 60, daily_kwh: 0.36, night_kwh: 0.18, margin_pct: 20 },
    verify: ["total_load_w", "daily_kwh", "appliances"],
  },
  {
    module: "banner", model: "Banner",
    create: "createBanners", list: "listBanners", del: "deleteBanners",
    row: { name: "Verify Banner", slot: "home_hero", image_url: "https://example.com/a.png", image_width: 1200, image_height: 400, image_mime_type: "image/png", status: "draft" },
    verify: ["name", "slot", "image_width"],
  },
  {
    module: "stock_transfer", model: "StockTransfer",
    create: "createStockTransfers", list: "listStockTransfers", del: "deleteStockTransfers",
    row: { from_location_id: REF, to_location_id: REF, inventory_item_id: REF, quantity: 1, order_id: REF, status: "completed" },
    verify: ["quantity", "status", "inventory_item_id"],
  },
  {
    module: "ceedmart_tax", model: "TaxOverride",
    create: "createTaxOverrides", list: "listTaxOverrides", del: "deleteTaxOverrides",
    row: { name: "Verify VAT", rate: 7.5, scope: "general", is_active: true },
    verify: ["name", "rate", "scope"],
  },
  {
    module: "search_log", model: "SearchLog",
    create: "createSearchLogs", list: "listSearchLogs", del: "deleteSearchLogs",
    row: { query: "verify", result_count: 0 },
    verify: ["query", "result_count"],
  },
  {
    module: "careers", model: "Requisition",
    create: "createRequisitions", list: "listRequisitions", del: "deleteRequisitions",
    row: { title: "Verify Role", description: "<p>verify</p>", apply_url: "https://example.com/apply", status: "open" },
    verify: ["title", "apply_url"],
  },
]

// Structural comparison, because jsonb does not preserve key order — an
// object written {key, label, type} comes back {key, type, label}, and a
// JSON.stringify comparison calls that a mismatch. What we are testing is
// whether the value survived the round trip, not how Postgres stored it.
const same = (written: unknown, read: unknown): boolean => {
  if (written instanceof Date) {
    return read instanceof Date
      ? written.getTime() === read.getTime()
      : new Date(String(read)).getTime() === written.getTime()
  }

  // bigNumber reads back as a string or a BigNumber-like value, never the
  // number that went in. That is expected; a wrong VALUE is not.
  if (typeof written === "number") return Number(read) === written

  if (Array.isArray(written)) {
    return (
      Array.isArray(read) &&
      read.length === written.length &&
      written.every((v, i) => same(v, read[i]))
    )
  }

  if (written && typeof written === "object") {
    if (!read || typeof read !== "object" || Array.isArray(read)) return false
    const a = written as Record<string, unknown>
    const b = read as Record<string, unknown>
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => same(a[k], b[k]))
    )
  }

  return read === written
}

export default async function verifySchema({ container }: ExecArgs) {
  // Refuse to run anywhere but a scratch database.
  //
  // This script writes and deletes rows. `medusa exec` loads .env itself, and
  // dotenv does not overwrite a DATABASE_URL already in the environment — but
  // that is a property of a dependency, not a guarantee, and being wrong here
  // means writing to the real database. So ask the connection where it
  // actually landed rather than trusting what we exported.
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  const { rows } = await pg.raw("select current_database() as db")
  const database = rows[0].db

  if (!/verify/.test(database) && process.env.SCHEMA_VERIFY_ALLOW_ANY_DB !== "1") {
    console.log(
      `Refusing to run against "${database}" — it is not a scratch database.\n` +
        `Use \`yarn verify:schema\`, which creates and drops one. To override, ` +
        `set SCHEMA_VERIFY_ALLOW_ANY_DB=1.`
    )
    console.log("\nSCHEMA_VERIFY_FAILED")
    return
  }

  console.log(`Verifying ${CHECKS.length} models against "${database}"\n`)

  const failures: string[] = []
  let passed = 0

  for (const check of CHECKS) {
    const label = `${check.module}.${check.model}`
    let created: any = null
    let svc: any

    try {
      svc = container.resolve(check.module)
    } catch (err: any) {
      failures.push(`${label}: module "${check.module}" is not registered`)
      console.log(` FAIL ${label} — module not registered`)
      continue
    }

    try {
      // MedusaService derives method names by pluralising the model name, so
      // a wrong guess here would look like a schema failure. Say plainly that
      // it is not one, and list what the service actually exposes.
      if (typeof svc[check.create] !== "function") {
        const available = Object.getOwnPropertyNames(Object.getPrototypeOf(svc))
          .filter((m) => m.startsWith("create"))
          .join(", ")
        throw new Error(
          `service has no ${check.create}() — this check is mis-named, not a schema bug. Available: ${available}`
        )
      }

      // 1. Write. This is what catches a missing or mis-named column.
      created = await svc[check.create](check.row)
      const row = Array.isArray(created) ? created[0] : created
      if (!row?.id) throw new Error("create returned no id")

      // 2. Read back through the same service. A bigNumber that wrote but
      //    reads back wrong means the raw_ companion is not wired up.
      const [found] = await svc[check.list]({ id: row.id }, { take: 1 })
      if (!found) throw new Error("row was written but could not be read back")

      for (const field of check.verify ?? []) {
        if (!same(check.row[field], found[field])) {
          throw new Error(
            `${field} round-tripped as ${JSON.stringify(found[field])}, wrote ${JSON.stringify(check.row[field])}`
          )
        }
      }

      // 3. Clean up so the script is re-runnable against a live database
      //    if someone points it at one.
      await svc[check.del](row.id)

      passed++
      console.log(`  ok  ${label}`)
    } catch (err: any) {
      const message = String(err?.message ?? err).split("\n")[0]
      failures.push(`${label}: ${message}`)
      console.log(` FAIL ${label} — ${message}`)

      // Best effort cleanup on a partial failure.
      try {
        const row = Array.isArray(created) ? created[0] : created
        if (row?.id) await svc[check.del](row.id)
      } catch {
        // Nothing more to do.
      }
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed of ${CHECKS.length} models`)

  if (failures.length) {
    console.log("\nFailures:")
    for (const f of failures) console.log(`  ${f}`)
    // medusa exec does not propagate a thrown error as a non-zero exit, so
    // the wrapper greps for this line. Keep it in step with verify-schema.mjs.
    console.log("\nSCHEMA_VERIFY_FAILED")
    return
  }

  console.log("SCHEMA_VERIFY_OK")
}
