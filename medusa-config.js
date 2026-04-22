const { defineConfig } = require("@medusajs/utils")
const path = require("path")
const os = require("os")

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL || "postgres://localhost/ceedmart",
    redisUrl: process.env.REDIS_URL || undefined,
    workerMode: process.env.MEDUSA_WORKER_MODE || "shared",
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:7001,http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:8000,http://localhost:7001,http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET || "ceedmart-jwt-secret-key-2024",
      cookieSecret: process.env.COOKIE_SECRET || "ceedmart-cookie-secret-key-2024",
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL || "http://localhost:9000",
  },
  modules: {
    notification: {
      resolve: "@medusajs/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/notification-local",
            id: "local",
            options: {
              name: "Local Notification Provider",
              channels: ["feed"],
            },
          },
        ],
      },
    },
    file: {
      resolve: "@medusajs/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-local",
            id: "local",
            options: {
              upload_dir: path.join(os.tmpdir(), "ceedmart-uploads"),
              private_upload_dir: path.join(os.tmpdir(), "ceedmart-static"),
            },
          },
        ],
      },
    },
    fulfillment: {
      resolve: "@medusajs/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/fulfillment-manual",
            id: "manual",
          },
        ],
      },
    },
    payment: {
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
              successRedirectUrl: process.env.STORE_CORS ? process.env.STORE_CORS.split(",")[0] + "/ng/checkout?step=review" : "http://localhost:8000/ng/checkout?step=review",
              failureRedirectUrl: process.env.STORE_CORS ? process.env.STORE_CORS.split(",")[0] + "/ng/checkout?step=payment" : "http://localhost:8000/ng/checkout?step=payment",
            },
          },
        ],
      },
    },
  },
})
