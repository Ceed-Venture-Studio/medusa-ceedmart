import crypto from "crypto"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Give existing customers a Pulse Identity so they can pay.
//
//   yarn backfill:pulse          report only, changes nothing
//   yarn backfill:pulse apply    actually register and save
//
// "apply" rather than "--apply" because `medusa exec` parses its own flags
// and rejects any it does not recognise before the script ever runs.
//
// ── Why this is needed ──────────────────────────────────────────────────
// pim_id is written once, during registration, by a step that CATCHES its
// own errors and returns null. That is deliberate — a Pulse outage should
// not stop someone creating an account — but it means a customer can exist
// with no Pulse identity and nothing surfaces until they reach checkout and
// initiatePayment throws.
//
// Two ways to end up here:
//
//   • Registration failed at the time. A misconfigured tenant, a Pulse
//     outage, an unreachable host — the account was created regardless.
//   • The pim_id belongs to a DIFFERENT Pulse instance. pim_id is issued by
//     whichever Identity registered the customer; point the app at another
//     instance and every stored id becomes meaningless. Those customers look
//     fine in the database and fail at the gateway.
//
// So a present pim_id is not evidence of a working one. This VERIFIES each
// id against the configured Identity before deciding to skip it.
//
// ── The password ────────────────────────────────────────────────────────
// Pulse registration requires one, and we do not have the customer's — it
// is hashed by Medusa's auth provider and was only ever passed through at
// signup. A random one is generated instead.
//
// That is safe because nothing signs a customer into Pulse directly: tokens
// are minted with POST /tenants/{t}/customers/{pimId}/token, which takes the
// tenant API key and no password. If that ever changes — if a customer needs
// to authenticate against Pulse themselves — these accounts will need a
// password reset through Pulse, and this comment is the warning.

type Row = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  pim_id: string | null
}

/**
 * Pulse rejects anything that is not E.164. Medusa stores whatever the
 * customer typed, so "08012345678" is common and has to be converted rather
 * than sent as-is and lost to a validation error.
 */
const toE164 = (phone: string | null): string | null => {
  if (!phone) return null
  const digits = phone.replace(/[^\d+]/g, "")
  if (digits.startsWith("+")) return digits
  // Nigerian local format: 0803… → +234803…
  if (digits.startsWith("0") && digits.length === 11) return `+234${digits.slice(1)}`
  if (digits.startsWith("234")) return `+${digits}`
  return null
}

/** Pulse requires at least 2 characters, and Medusa does not. */
const name = (value: string | null, fallback: string): string => {
  const trimmed = (value ?? "").trim()
  return trimmed.length >= 2 ? trimmed : fallback
}

const generatePassword = (): string =>
  `Cm${crypto.randomBytes(9).toString("base64url")}9aA!`

export default async function backfillPulseIdentity({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const apply = (args ?? []).includes("apply")

  const baseUrl =
    process.env.PULSE_IDENTITY_BASE_URL ||
    "https://pulse-identity-manager-218803590341.europe-west1.run.app/api/v1"
  const tenantId = process.env.PULSE_IDENTITY_TENANT_ID
  const applicationId = process.env.PULSE_IDENTITY_APP_ID
  const apiKey = process.env.PULSE_IDENTITY_API_KEY

  if (!tenantId || !applicationId || !apiKey) {
    logger.error(
      "Missing Pulse Identity configuration — set PULSE_IDENTITY_TENANT_ID, " +
        "PULSE_IDENTITY_APP_ID and PULSE_IDENTITY_API_KEY."
    )
    return
  }

  console.log(`Identity : ${baseUrl}`)
  console.log(`Tenant   : ${tenantId}`)
  console.log(apply ? "Mode     : APPLY — will register and save\n" : "Mode     : dry run — pass `apply` to write\n")

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer",
    fields: ["id", "email", "first_name", "last_name", "phone", "pim_id", "has_account"],
    filters: { has_account: true },
  })

  const customers = (data as any[]).filter((c) => c.email) as Row[]
  console.log(`${customers.length} customers with an account\n`)

  const headers = { "Content-Type": "application/json", "X-API-Key": apiKey }
  const counts = { ok: 0, registered: 0, stale: 0, failed: 0, skipped: 0 }

  for (const customer of customers) {
    const label = customer.email.padEnd(34)

    // A stored pim_id proves only that SOME instance once issued it. Ask the
    // one we are configured against whether it means anything here.
    if (customer.pim_id) {
      try {
        const res = await fetch(
          `${baseUrl}/tenants/${tenantId}/customers/${customer.pim_id}`,
          { headers }
        )
        if (res.ok) {
          counts.ok++
          console.log(`  ok      ${label} ${customer.pim_id}`)
          continue
        }
        counts.stale++
        console.log(
          `  stale   ${label} ${customer.pim_id} — unknown to this instance (${res.status})`
        )
      } catch (err: any) {
        counts.failed++
        console.log(`  FAIL    ${label} could not reach Identity: ${err?.message ?? err}`)
        continue
      }
    }

    const phone = toE164(customer.phone)
    if (!phone) {
      // Registering without a phone succeeds, but the customer then has no
      // verified contact on the Pulse side. Say so rather than hide it.
      console.log(`  note    ${label} phone "${customer.phone ?? ""}" is not E.164 — registering without it`)
    }

    if (!apply) {
      counts.skipped++
      console.log(`  would   ${label} register`)
      continue
    }

    try {
      const res = await fetch(
        `${baseUrl}/tenants/${tenantId}/applications/${applicationId}/customers/register`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            firstName: name(customer.first_name, "Customer"),
            lastName: name(customer.last_name, "Account"),
            email: customer.email,
            password: generatePassword(),
            scope: "customer",
            ...(phone ? { phone } : {}),
          }),
        }
      )

      const body: any = await res.json().catch(() => ({}))
      const pimId = body?.payload?.value?.pimId

      if (!res.ok || !pimId) {
        counts.failed++
        const message = body?.error?.message ?? res.statusText
        console.log(`  FAIL    ${label} ${message}`)
        continue
      }

      // Written through the customer module rather than raw SQL so any
      // subscriber watching customer.updated sees it.
      const customerModule: any = container.resolve("customer")
      await customerModule.updateCustomers(customer.id, { pim_id: pimId })

      counts.registered++
      console.log(`  saved   ${label} ${pimId}`)
    } catch (err: any) {
      counts.failed++
      console.log(`  FAIL    ${label} ${err?.message ?? err}`)
    }
  }

  console.log(
    `\n${counts.ok} already valid, ${counts.registered} registered, ` +
      `${counts.stale} stale, ${counts.failed} failed, ${counts.skipped} pending (dry run)`
  )

  if (!apply && counts.skipped) {
    console.log("\nRe-run as `yarn backfill:pulse apply` to register them.")
  }
}
