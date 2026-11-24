#!/usr/bin/env node
// Ceedmart shopping MCP over Streamable HTTP, for Cloud Run.
//
//   POST /mcp      MCP requests (stateless: a fresh server per request, so any
//                  instance can answer and nothing is held in memory — the
//                  shopper's cart lives in the backend)
//   GET  /health   liveness (not /healthz: Cloud Run reserves paths ending in z)
//
// Environment:
//   MCP_ACCESS_TOKEN        bearer SmartAI presents (32+ characters)
//   CEEDMART_API_URL        Medusa backend, e.g. https://ceedmart-api-staging-…run.app
//   SMARTAI_BACKEND_SECRET  bearer this server presents to /smartai/* (32+)
// The two secrets are different values; neither is shared with anyone else.

import { createServer as createHttpServer } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createServer } from "./create-server.js"

const port = Number(process.env.PORT ?? 8080)
const accessToken = process.env.MCP_ACCESS_TOKEN ?? ""
const config = {
  apiUrl: (process.env.CEEDMART_API_URL ?? "").replace(/\/$/, ""),
  backendSecret: process.env.SMARTAI_BACKEND_SECRET ?? "",
}
const problems = [
  accessToken.length < 32 && "MCP_ACCESS_TOKEN must be set (32+ characters).",
  !/^https?:\/\//.test(config.apiUrl) && "CEEDMART_API_URL must be set.",
  config.backendSecret.length < 32 && "SMARTAI_BACKEND_SECRET must be set (32+ characters).",
].filter(Boolean)
if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}

const MAX_BODY = 1_000_000

const authorized = (header) => {
  const presented = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, ""))
  const expected = Buffer.from(accessToken)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })

const rpcError = (res, status, message) =>
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null })

createHttpServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname

  if (path === "/health") return sendJson(res, 200, { ok: true })
  if (path !== "/mcp") return sendJson(res, 404, { error: "Not found. The MCP endpoint is /mcp." })
  if (!authorized(req.headers.authorization)) {
    res.setHeader("www-authenticate", 'Bearer realm="ceedmart-shopping"')
    return rpcError(res, 401, "Missing or wrong access token.")
  }
  if (req.method !== "POST") return rpcError(res, 405, "Method not allowed; use POST.")

  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (e) {
    return rpcError(res, e.status ?? 400, e.status ? e.message : "Body must be JSON.")
  }

  const server = createServer(config)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on("close", () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (e) {
    console.error("[mcp] request failed:", e)
    if (!res.headersSent) rpcError(res, 500, "Internal error")
  }
}).listen(port, () => console.log(`ceedmart-shopping MCP listening on :${port}/mcp`))
