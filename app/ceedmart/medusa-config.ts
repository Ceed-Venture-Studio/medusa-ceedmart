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
      },
    }
  : {
      resolve: "@medusajs/file-local",
      id: "local",
      options: {
        upload_dir: "static",
        private_upload_dir: "static-private",
      },
    }

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

if (isProduction && !redisUrl) {
  console.warn(
    "[ceedmart] REDIS_URL is not set in production. " +
      "Using in-memory event bus / cache / workflow engine. " +
      "Pin Cloud Run to min=max=1 instance or set REDIS_URL."
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
              serviceKey: process.env.PULSE_PAYMENT_SERVICE_KEY,
              tenantId: process.env.PULSE_IDENTITY_TENANT_ID,
              bearerToken: process.env.PULSE_PAYMENT_BEARER_TOKEN,
              channel: "paystack",
              successRedirectUrl: process.env.STORE_CORS
                ? process.env.STORE_CORS.split(",")[0] + "/ng/checkout?step=review"
                : "http://localhost:8000/ng/checkout?step=review",
              failureRedirectUrl: process.env.STORE_CORS
                ? process.env.STORE_CORS.split(",")[0] + "/ng/checkout?step=payment"
                : "http://localhost:8000/ng/checkout?step=payment",
            },
          },
        ],
      },
    },
    ...redisModules,
    search_log: {
      resolve: "./src/modules/search-log",
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
