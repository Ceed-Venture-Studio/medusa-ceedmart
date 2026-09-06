#!/usr/bin/env node
//
// Apply every migration to an empty database, then write one row per model.
//
//   yarn verify:schema
//
// ── What this catches that nothing else does ────────────────────────────
// Migrations and models are two descriptions of the same tables, written by
// hand, and nothing in `tsc`, `jest` or `medusa build` compares them. Three
// mismatches reached production:
//
//   • `raw_<field>` companion columns for bigNumber written as `<field>_raw`
//   • models whose derived table name did not match the migration's
//   • a column on the model that no migration ever created
//
// Every one is a hard error on the first insert and invisible until then.
// commission_entry carried the first for months: the subscriber caught the
// error and logged it, so partner commission accrued nothing, quietly.
//
// Running against a FRESH database is the point. An existing dev database
// has been patched by hand over months, so it can pass while a colleague's
// clean checkout — and production's next deploy — fails.
//
// ── Where the scratch database lives ────────────────────────────────────
// Same server and credentials as DATABASE_URL, different database name. That
// needs no new configuration and cannot reach the real one: the name is
// fixed here, and verify-schema.ts independently asks the connection which
// database it landed in and refuses anything that is not a scratch one.

import { spawn } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import pg from "pg"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const SCRATCH_DB = process.env.SCHEMA_VERIFY_DB || "ceedmart_schema_verify"

// ─── Locate the database server ───────────────────────────────────────────

const readEnvFile = () => {
  const path = resolve(root, ".env")
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

const baseUrl = process.env.DATABASE_URL || readEnvFile().DATABASE_URL

if (!baseUrl) {
  console.error("No DATABASE_URL in the environment or .env — cannot find a database server.")
  process.exit(1)
}

const urlFor = (database) => {
  const url = new URL(baseUrl)
  url.pathname = `/${database}`
  return url.toString()
}

// Connect to the maintenance database to create and drop the scratch one;
// you cannot drop a database you are connected to.
const adminUrl = urlFor("postgres")
const scratchUrl = urlFor(SCRATCH_DB)

const target = new URL(baseUrl)
console.log(`Server:   ${target.host}`)
console.log(`Scratch:  ${SCRATCH_DB}`)
console.log(`(the real database, ${target.pathname.slice(1)}, is not touched)\n`)

// ─── Helpers ──────────────────────────────────────────────────────────────

const admin = async (sql) => {
  const client = new pg.Client({ connectionString: adminUrl })
  await client.connect()
  try {
    return await client.query(sql)
  } finally {
    await client.end()
  }
}

const dropScratch = async () => {
  // FORCE terminates any connection a crashed run left behind, so a failure
  // never wedges the next run.
  await admin(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`)
}

/** Run a command with the scratch database as its DATABASE_URL. */
const run = (command, args, { capture = false } = {}) =>
  new Promise((done) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, DATABASE_URL: scratchUrl, NODE_ENV: "development" },
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
      shell: false,
    })

    let output = ""
    if (capture) {
      const collect = (chunk) => {
        const text = chunk.toString()
        output += text
        process.stdout.write(text)
      }
      child.stdout.on("data", collect)
      child.stderr.on("data", collect)
    }

    child.on("close", (code) => done({ code, output }))
  })

// ─── Run ──────────────────────────────────────────────────────────────────

let exitCode = 1

try {
  await dropScratch()
  await admin(`CREATE DATABASE "${SCRATCH_DB}"`)
} catch (err) {
  console.error(`Could not create the scratch database: ${err.message}`)
  console.error(`Is Postgres running at ${target.host}?`)
  process.exit(1)
}

try {
  console.log("── Applying migrations ──")
  const migrate = await run("npx", ["medusa", "db:migrate"])

  if (migrate.code !== 0) {
    // A migration that will not apply to an empty database is itself the
    // finding — it means a clean checkout cannot stand the schema up.
    console.error("\nMigrations failed against an empty database.")
    process.exit(1)
  }

  console.log("\n── Writing one row per model ──")
  const verify = await run(
    "npx",
    ["medusa", "exec", "./src/scripts/verify-schema.ts"],
    { capture: true }
  )

  // `medusa exec` swallows a thrown error into its own exit code handling, so
  // the verifier reports its verdict on stdout. Keep these two markers in step
  // with the ones in src/scripts/verify-schema.ts.
  if (verify.output.includes("SCHEMA_VERIFY_OK")) {
    exitCode = 0
  } else if (verify.output.includes("SCHEMA_VERIFY_FAILED")) {
    exitCode = 1
  } else {
    console.error("\nThe verifier did not report a verdict — it likely crashed on startup.")
    exitCode = 1
  }
} finally {
  // Always clean up, including after a failure: leaving the scratch database
  // behind means the next run inherits a half-migrated schema and lies.
  try {
    await dropScratch()
  } catch (err) {
    console.error(`Warning: could not drop ${SCRATCH_DB}: ${err.message}`)
  }
}

process.exit(exitCode)
