import { defineConfig, Modules } from "@medusajs/framework/utils"
import os from "os"
import path from "path"

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

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    backendUrl: "http://localhost:9000",
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
  },
})
