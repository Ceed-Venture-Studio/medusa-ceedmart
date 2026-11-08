// Ceedmart store API — MCP server for building the Ceedmart mobile app.
//
// Gives an AI assistant (Claude Code, Claude Desktop, Cursor…) what a mobile
// developer needs while building against the Ceedmart backend:
//
//   get_environment   which backend, which key, the live location map
//   list_endpoints    the store API catalog, filterable
//   get_endpoint      one endpoint in full: params, response, Ceedmart rules
//   get_guide         integration guides (also exposed as MCP resources)
//   call_store_api    a real request to the staging store API
//
// call_store_api is fenced: only /store/* and customer auth paths, and only
// against staging unless CEEDMART_ALLOW_PRODUCTION=read-only is set, which
// still allows GET requests only. Staging holds anonymised data, takes no
// real payments and sends no email or SMS, so it is safe to experiment on.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkRequest, summarizeEndpoint, truncate } from "./lib.js"

const here = dirname(fileURLToPath(import.meta.url))

export const STAGING_API_URL =
  "https://ceedmart-api-staging-870514614467.europe-west1.run.app"
// A publishable key is public by design (it ships inside every app build);
// this one is staging's "Mobile app (staging)" key.
export const STAGING_PUBLISHABLE_KEY =
  "pk_e1710ced4688fa8f22c119a9ba620273d3830e60d21342f87b226313eee3f2b2"

const config = {
  apiUrl: (process.env.CEEDMART_API_URL || STAGING_API_URL).replace(/\/$/, ""),
  publishableKey:
    process.env.CEEDMART_PUBLISHABLE_KEY || STAGING_PUBLISHABLE_KEY,
  allowProduction: process.env.CEEDMART_ALLOW_PRODUCTION === "read-only",
}
config.isStaging =
  config.apiUrl === STAGING_API_URL ||
  /staging|localhost|127\.0\.0\.1/.test(config.apiUrl)

const endpoints = JSON.parse(
  readFileSync(join(here, "catalog", "endpoints.json"), "utf8")
)

const guides = Object.fromEntries(
  readdirSync(join(here, "guides"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(here, "guides", f), "utf8")
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? f
      return [f.replace(/^\d+-/, "").replace(/\.md$/, ""), { title, text }]
    })
)

const json = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
})
const text = (value) => ({ content: [{ type: "text", text: value }] })
const fail = (message) => ({
  content: [{ type: "text", text: message }],
  isError: true,
})

/** A fully registered MCP server. One per stdio process; one per request over HTTP. */
export const createServer = () => {
  const server = new McpServer({ name: "ceedmart-store-api", version: "0.1.0" })

  server.registerTool(
    "get_environment",
    {
      title: "Ceedmart environment",
      description:
        "Which Ceedmart backend this server talks to, the publishable key to put in the app, and the live location map (sales channel per city and its state code). Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      let locations = null
      let regions = null
      try {
        const headers = { "x-publishable-api-key": config.publishableKey }
        const [l, r] = await Promise.all([
          fetch(`${config.apiUrl}/store/web-locations`, { headers }).then((x) =>
            x.json()
          ),
          fetch(`${config.apiUrl}/store/regions`, { headers }).then((x) =>
            x.json()
          ),
        ])
        locations = l
        regions = (r.regions ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          currency_code: g.currency_code,
          countries: (g.countries ?? []).map((c) => c.iso_2),
        }))
      } catch (e) {
        locations = `unreachable: ${e.message}`
      }
      return json({
        api_url: config.apiUrl,
        environment: config.isStaging ? "staging" : "other",
        publishable_key: config.publishableKey,
        live_calls: config.isStaging
          ? "allowed (staging)"
          : config.allowProduction
            ? "GET only (CEEDMART_ALLOW_PRODUCTION=read-only)"
            : "disabled outside staging",
        regions,
        web_locations: locations,
        notes: [
          "Staging data is an anonymised copy of production. Customers there are fake; create your own test account.",
          "Pulse Pay is not configured on staging: use the manual providers (pp_bank-transfer_manual) to place test orders.",
          "Staging sends no email or SMS.",
          "The first request after a quiet spell can take 1–3 minutes while staging starts.",
        ],
      })
    }
  )

  server.registerTool(
    "list_endpoints",
    {
      title: "List store API endpoints",
      description:
        "List the Ceedmart store API endpoints a shopping app uses, with a one-line summary each. Filter by group or a search word, then call get_endpoint for detail.",
      inputSchema: {
        group: z
          .string()
          .optional()
          .describe(
            "auth, customer, catalog, locations, cart, checkout, orders, content, preorders, builds, auctions, solar, requisitions, misc"
          ),
        search: z
          .string()
          .optional()
          .describe("Word to match in path or summary"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ group, search }) => {
      const q = search?.toLowerCase()
      const rows = endpoints
        .filter((e) => !group || e.group === group)
        .filter(
          (e) =>
            !q ||
            e.path.toLowerCase().includes(q) ||
            e.summary.toLowerCase().includes(q) ||
            e.id.includes(q)
        )
        .map(summarizeEndpoint)
      return json({ count: rows.length, endpoints: rows })
    }
  )

  server.registerTool(
    "get_endpoint",
    {
      title: "Endpoint detail",
      description:
        "Full detail for one endpoint: auth, path/query/body parameters, response shape and Ceedmart-specific rules. Pass the id from list_endpoints, or a method and path.",
      inputSchema: {
        id: z.string().optional(),
        method: z.enum(["GET", "POST", "DELETE"]).optional(),
        path: z
          .string()
          .optional()
          .describe("e.g. /store/carts/{id}/line-items"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, method, path }) => {
      const match = endpoints.find(
        (e) =>
          (id && e.id === id) ||
          (path && e.path === path && (!method || e.method === method))
      )
      if (!match) {
        return fail(
          `No endpoint matches ${id ?? `${method ?? ""} ${path ?? ""}`}. Use list_endpoints to find it.`
        )
      }
      return json(match)
    }
  )

  server.registerTool(
    "get_guide",
    {
      title: "Integration guide",
      description: `Read a Ceedmart integration guide. Topics: ${Object.keys(guides).join(", ")}. Start with "overview".`,
      inputSchema: {
        topic: z.string().describe(`One of: ${Object.keys(guides).join(", ")}`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => {
      const guide = guides[topic]
      if (!guide) {
        return fail(
          `Unknown topic "${topic}". Topics: ${Object.keys(guides).join(", ")}`
        )
      }
      return text(guide.text)
    }
  )

  server.registerTool(
    "call_store_api",
    {
      title: "Call the store API",
      description:
        "Make a real request to the Ceedmart store API (staging) and return the status and JSON body. The publishable key is added for you. Only /store/* and /auth/customer/* paths are allowed. Use it to check request shapes, try a checkout end to end, or see real response data before writing app code.",
      inputSchema: {
        method: z.enum(["GET", "POST", "DELETE"]),
        path: z
          .string()
          .describe(
            "Path with any ids filled in, e.g. /store/carts/cart_123/line-items"
          ),
        query: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
          )
          .optional()
          .describe("Query parameters; arrays become repeated keys"),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("JSON body for POST"),
        customer_token: z
          .string()
          .optional()
          .describe(
            "A customer JWT from POST /auth/customer/emailpass, sent as Bearer"
          ),
        max_chars: z
          .number()
          .int()
          .min(1000)
          .max(200000)
          .optional()
          .describe(
            "Truncate the response body to this many characters (default 30000)"
          ),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ method, path, query, body, customer_token, max_chars }) => {
      const refusal = checkRequest({ method, path, config })
      if (refusal) return fail(refusal)

      const url = new URL(config.apiUrl + path)
      for (const [k, v] of Object.entries(query ?? {})) {
        for (const item of Array.isArray(v) ? v : [v])
          url.searchParams.append(k, String(item))
      }
      const headers = {
        "x-publishable-api-key": config.publishableKey,
        accept: "application/json",
      }
      if (body) headers["content-type"] = "application/json"
      if (customer_token) headers.authorization = `Bearer ${customer_token}`

      const started = Date.now()
      let res
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(240_000),
        })
      } catch (e) {
        return fail(
          `Request failed: ${e.message}. Staging may be starting up; retry in a minute.`
        )
      }
      const raw = await res.text()
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
      const bodyText = truncate(
        typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2),
        max_chars ?? 30_000
      )
      return {
        content: [
          {
            type: "text",
            text: `${method} ${url.pathname}${url.search} → ${res.status} ${res.statusText} (${Date.now() - started} ms)\n\n${bodyText}`,
          },
        ],
        isError: res.status >= 400,
      }
    }
  )

  for (const [topic, guide] of Object.entries(guides)) {
    server.registerResource(
      `guide-${topic}`,
      `ceedmart://guides/${topic}`,
      { title: guide.title, mimeType: "text/markdown" },
      async (uri) => ({
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: guide.text },
        ],
      })
    )
  }

  server.registerResource(
    "endpoint-catalog",
    "ceedmart://catalog/endpoints.json",
    { title: "Store API endpoint catalog", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(endpoints, null, 2),
        },
      ],
    })
  )

  return server
}
