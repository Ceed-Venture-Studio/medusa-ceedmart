const { defineConfig } = require("@medusajs/utils")
const path = require("path")
const os = require("os")

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: "postgres://postgres:admin@localhost:5432/ceedmart",
    http: {
      storeCors: "http://localhost:8000",
      adminCors: "http://localhost:7001,http://localhost:9000",
      authCors: "http://localhost:8000,http://localhost:7001,http://localhost:9000",
      jwtSecret: "ceedmart-jwt-secret-key-2024",
      cookieSecret: "ceedmart-cookie-secret-key-2024",
    },
  },
  admin: {
    disable: true,
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
  },
})
