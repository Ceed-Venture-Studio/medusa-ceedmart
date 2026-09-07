import { defineConfig, Modules } from "@medusajs/framework/utils"

// `medusa build` evaluates this file with no real env vars in place, so we
// cannot throw on missing values at config-load time — that would break the
// build. Instead we collect missing-env warnings and log them once at the end
// so a misconfigured prod start still surfaces clearly.
const missingEnvs: string[] = []
const required = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    missingEnvs.push(name)
    return ""
  }
  return value
}

const notificationProviders: any[] = [
  {
    resolve: "@medusajs/notification-local",
    id: "local",
    options: {
      name: "Local Notification Provider",
      channels: ["feed"],
    },
  },
]

if (process.env.PULSE_NOTIFICATION_EMAIL_TOKEN) {
  notificationProviders.push({
    resolve: "@medusajs/notification-pulse-email",
    id: "pulse-email",
    options: {
      token: process.env.PULSE_NOTIFICATION_EMAIL_TOKEN,
      application_id: process.env.PULSE_IDENTITY_APP_ID,
      from: "noreply@ceedmart.com",
      alias: "Ceedmart",
      channels: ["email"],
    },
  })
}

if (process.env.PULSE_NOTIFICATION_SMS_TOKEN) {
  notificationProviders.push({
    resolve: "@medusajs/notification-pulse-sms",
    id: "pulse-sms",
    options: {
      token: process.env.PULSE_NOTIFICATION_SMS_TOKEN,
      application_id: process.env.PULSE_IDENTITY_APP_ID,
      channels: ["sms"],
    },
  })
}

// Where customers actually are. Falls back to the first CORS origin only so
// an unconfigured environment keeps its old behaviour rather than breaking
// outright — but that fallback is what produced the wrong-port bug, so set
// STOREFRONT_URL explicitly.
const storefrontUrl =
  process.env.STOREFRONT_URL ||
  process.env.STORE_CORS?.split(",")[0] ||
  "http://localhost:8000"

const isProduction = process.env.NODE_ENV === "production"
const redisUrl = process.env.REDIS_URL

// File storage: S3-compatible (GCS in prod, local fallback in dev).
const fileProvider = process.env.S3_BUCKET
  ? {
      resolve: "@medusajs/file-s3",
      id: "s3",
      options: {
        file_url: process.env.S3_FILE_URL || `https://storage.googleapis.com/${process.env.S3_BUCKET}`,
        access_key_id: required("S3_ACCESS_KEY_ID"),
        secret_access_key: required("S3_SECRET_ACCESS_KEY"),
        region: process.env.S3_REGION || "auto",
        bucket: process.env.S3_BUCKET,
        endpoint: process.env.S3_ENDPOINT || "https://storage.googleapis.com",
        prefix: process.env.S3_PREFIX || "",
        // GCS S3-compat rejects the AWS SDK v3 default flexible checksums
        // (x-amz-checksum-crc32 etc.) with "Invalid argument". Disable both
        // the request-side checksum calc and response-side validation, and
        // force path-style URLs since virtual-host style on GCS occasionally
        // misbehaves with bucket names containing dots/dashes.
        additional_client_config: {
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
          forcePathStyle: true,
        },
        // GCS doesn't support AWS canned ACLs (x-amz-acl); sending one makes
        // it reject the whole PUT with "Invalid argument". Access is governed
        // by the bucket-level `allUsers:roles/storage.objectViewer` IAM
        // binding instead, so every upload is publicly readable without an
        // explicit per-object ACL.
        disable_acl: true,
      },
    }
  : {
      resolve: "@medusajs/file-local",
      id: "local",
      options: {
        upload_dir: "static",
        // Nest under static/ so the medusa develop watcher (which ignores
        // "static") doesn't restart mid-upload — CSV imports land here and
        // a restart between POST /admin/uploads and POST /admin/products/imports
        // surfaces in the admin as "failed to fetch".
        private_upload_dir: "static/.private",
        // file-local returns a public URL to the admin so images can render.
        // Default is http://localhost:9000/static, but on this machine 9000
        // is taken by MinIO, so we run dev on 9100 and the URL must match.
        backend_url:
          process.env.FILE_LOCAL_BASE_URL ||
          `http://localhost:${process.env.PORT || 9100}/static`,
      },
    }

// Banner storage targets a separate GCS bucket (banner_ads in prod,
// banner_ads_dev locally) but the Medusa file module only supports one
// provider at a time. The banner upload route writes directly via the
// AWS S3 SDK using BANNERS_S3_* env vars — see src/lib/banner/upload.ts.

// Redis-backed modules — required for multi-instance / non-shared worker deployments.
const redisModules: Record<string, any> = redisUrl
  ? {
      [Modules.EVENT_BUS]: {
        resolve: "@medusajs/event-bus-redis",
        options: { redisUrl },
      },
      [Modules.CACHE]: {
        resolve: "@medusajs/cache-redis",
        options: { redisUrl },
      },
      [Modules.WORKFLOW_ENGINE]: {
        resolve: "@medusajs/workflow-engine-redis",
        options: { redis: { url: redisUrl } },
      },
    }
  : {}

// P0-6 — Redis is a hard production requirement.
//
// Without it the event bus, cache and workflow engine all fall back to
// in-memory implementations. That was survivable while the platform ran no
// scheduled work: the documented mitigation was to pin Cloud Run to
// min=max=1 and accept the single point of failure.
//
// Phase 3 changes that. Auction activation and closing, quote expiry and
// winner-payment deadlines are scheduled jobs whose correctness depends on
// the workflow engine surviving a restart and not double-executing across
// instances (BRD §8.8, §12.2). An in-memory engine silently satisfies
// neither, and the failure mode — an auction that never closes, or closes
// twice — is invisible until it costs a customer.
//
// So a missing REDIS_URL now refuses to boot rather than degrading quietly.
// Deliberate single-instance operation is still possible, but it has to be
// stated out loud via MEDUSA_ALLOW_IN_MEMORY=true.
//
// Safe to throw here: the Dockerfile sets NODE_ENV=production only AFTER
// `yarn build` runs, so `medusa build` never evaluates this branch.
const allowInMemory = process.env.MEDUSA_ALLOW_IN_MEMORY === "true"

if (isProduction && !redisUrl) {
  if (!allowInMemory) {
    throw new Error(
      "[ceedmart] REDIS_URL is required in production.\n" +
        "Without it the event bus, cache and workflow engine run in-memory, " +
        "which cannot guarantee that scheduled jobs survive a restart or run " +
        "exactly once across instances.\n" +
        "Set REDIS_URL, or set MEDUSA_ALLOW_IN_MEMORY=true to run " +
        "single-instance deliberately (Cloud Run must then be pinned to " +
        "min=max=1, and scheduled jobs are not safe to enable)."
    )
  }

  console.warn(
    "[ceedmart] Running in production WITHOUT Redis because " +
      "MEDUSA_ALLOW_IN_MEMORY=true. Event bus, cache and workflow engine are " +
      "in-memory. Pin Cloud Run to min=max=1 and do not enable scheduled jobs."
  )
}

if (isProduction && !process.env.S3_BUCKET) {
  console.warn(
    "[ceedmart] S3_BUCKET is not set in production. " +
      "File uploads will be lost on container restart (Cloud Run is ephemeral)."
  )
}

// Now warn for any required env vars we couldn't satisfy.
// We do this AFTER all required() calls so the message lists everything.
// Note: defineConfig is evaluated below; required() calls happen first.

export default defineConfig({
  projectConfig: {
    databaseUrl: required("DATABASE_URL"),
    redisUrl,
    workerMode: (process.env.MEDUSA_WORKER_MODE as any) || "shared",
    http: {
      storeCors: required("STORE_CORS"),
      adminCors: required("ADMIN_CORS"),
      authCors: required("AUTH_CORS"),
      jwtSecret: required("JWT_SECRET"),
      cookieSecret: required("COOKIE_SECRET"),
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    // Empty default → admin SPA uses the current page origin for API calls.
    // That's correct for any local dev URL (localhost, LAN IP, tunnel) and
    // production sets MEDUSA_BACKEND_URL explicitly to its API hostname.
    backendUrl: process.env.MEDUSA_BACKEND_URL || "",
  },
  modules: {
    [Modules.AUTH]: {
      resolve: "@medusajs/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/auth-emailpass",
            id: "emailpass",
          },
        ],
      },
    },
    [Modules.FULFILLMENT]: {
      options: {
        providers: [
          {
            resolve: "@medusajs/fulfillment-manual",
            id: "manual",
          },
        ],
      },
    },
    [Modules.NOTIFICATION]: {
      resolve: "@medusajs/notification",
      options: {
        providers: notificationProviders,
      },
    },
    [Modules.FILE]: {
      resolve: "@medusajs/file",
      options: {
        providers: [fileProvider],
      },
    },
    [Modules.PAYMENT]: {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/payment-pulse-pay",
            id: "pulse-pay",
            options: {
              apiKey: process.env.PULSE_PAYMENT_API_KEY || process.env.PULSE_IDENTITY_API_KEY,
              // Optional. Pulse holds the gateway credential now; this is
              // only for tenants still bringing their own.
              serviceKey: process.env.PULSE_PAYMENT_SERVICE_KEY,
              tenantId: process.env.PULSE_IDENTITY_TENANT_ID,
              bearerToken: process.env.PULSE_PAYMENT_BEARER_TOKEN,
              // Points at a local Pulse Pay instance for validation. The
              // provider falls back to the hosted service when unset, so
              // production is unaffected by this being absent.
              baseUrl: process.env.PULSE_PAYMENT_BASE_URL,
              // PaymentCore validates JWT signatures against the Identity it
              // is paired with, so the provider mints a token per customer
              // rather than carrying a static one. Both must point at the
              // same environment.
              identityBaseUrl: process.env.PULSE_IDENTITY_BASE_URL,
              applicationId: process.env.PULSE_IDENTITY_APP_ID,
              // Unset by default: Pulse resolves the tenant's configured
              // provider and records it. Set only when the tenant has more
              // than one, where Pulse refuses to choose.
              channel: process.env.PULSE_PAYMENT_CHANNEL,
              // STOREFRONT_URL, not STORE_CORS[0]. CORS is a list of origins
              // ALLOWED to call us — order carries no meaning, and the first
              // entry here was http://localhost:8000 while the storefront
              // runs on 8100. A customer who paid was returned to a Docker
              // service and saw {"detail":"Not Found"}, with the money taken
              // and no order raised.
              successRedirectUrl: `${storefrontUrl}/ng/checkout?step=review`,
              failureRedirectUrl: `${storefrontUrl}/ng/checkout?step=payment`,
            },
          },
          // POS-only manual providers — cashier confirms receipt out-of-band.
          // Each registers as its own row in payment_provider so reports can
          // distinguish cash from card from bank-transfer from "other".
          {
            resolve: "./src/modules/payment-providers/cash",
            id: "manual",
          },
          {
            resolve: "./src/modules/payment-providers/card",
            id: "manual",
          },
          {
            resolve: "./src/modules/payment-providers/bank-transfer",
            id: "manual",
          },
          {
            resolve: "./src/modules/payment-providers/online",
            id: "manual",
          },
          {
            resolve: "./src/modules/payment-providers/other",
            id: "manual",
          },
        ],
      },
    },
    ...redisModules,
    audit: {
      resolve: "./src/modules/audit",
    },
    job_claim: {
      resolve: "./src/modules/job-claim",
    },
    notification_log: {
      resolve: "./src/modules/notification-log",
    },
    preorder: {
      resolve: "./src/modules/preorder",
    },
    build: {
      resolve: "./src/modules/build",
    },
    build_catalog: {
      resolve: "./src/modules/build-catalog",
    },
    auction: {
      resolve: "./src/modules/auction",
    },
    terms: {
      resolve: "./src/modules/terms",
    },
    listing_policy: {
      resolve: "./src/modules/listing-policy",
    },
    search_log: {
      resolve: "./src/modules/search-log",
    },
    solar: {
      resolve: "./src/modules/solar",
    },
    banner: {
      resolve: "./src/modules/banner",
    },
    careers: {
      resolve: "./src/modules/careers",
    },
    stock_transfer: {
      resolve: "./src/modules/stock-transfer",
    },
    partner: {
      resolve: "./src/modules/partner",
    },
    commission_entry: {
      resolve: "./src/modules/commission-entry",
    },
    ceedmart_tax: {
      resolve: "./src/modules/ceedmart-tax",
    },
    // Custom tax provider that reads Ceedmart tax overrides. Register via
    // Modules.TAX so it's selectable from Settings → Tax Regions.
    [Modules.TAX]: {
      resolve: "@medusajs/tax",
      options: {
        providers: [
          {
            resolve: "./src/modules/ceedmart-tax/provider",
            id: "ceedmart",
          },
        ],
      },
    },
  },
})

// Surface unsatisfied required envs once the config has been evaluated. Only
// scream in production — at build time these are expected to be missing.
if (isProduction && missingEnvs.length) {
  console.error(
    `[ceedmart] FATAL: missing required environment variables in production: ${missingEnvs.join(", ")}`
  )
}
