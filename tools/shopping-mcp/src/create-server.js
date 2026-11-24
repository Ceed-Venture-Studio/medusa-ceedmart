// Ceedmart shopping MCP — the three tools the SmartAI shopping assistant calls.
//
//   get_initial_recommendations   opening products for a chat
//   search_products               a catalogue search from the model's filters
//   manage_cart                   VIEW / ADD / REMOVE / UPDATE_QUANTITY / CLEAR
//
// Names and input schemas are exactly as in "Ceedmart MCP Requirements for
// the SmartAI Shopping Assistant" (19 Nov 2026), §4–6 — SmartAI's check fails
// a missing property or an extra required one. All Ceedmart logic (pricing for
// the state, availability, stock, listing types, the shopper's cart) lives in
// the Medusa backend at POST /smartai/tools/<name>; this server only forwards
// and returns the backend's answer as structuredContent.
// See app/ceedmart/docs/smartai-shopping-mcp-design.md.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

export const TOOL_TIMEOUT_MS = 7_000

/** Shapes exactly as SmartAI's requirements document writes them. */
export const TOOLS = {
  get_initial_recommendations: {
    description:
      "Opening product suggestions for the shopper: a short list of in-stock Ceedmart products, priced in naira for the shopper's location. Call when the shopper opens the chat or asks what is good.",
    inputSchema: {
      limit: z.number().int().optional().describe("Number of products to return (default 4, max 6)."),
      category_hint: z.string().optional().describe("Optional category focus if the user mentioned one."),
    },
    readOnly: true,
  },
  search_products: {
    description:
      "Search Ceedmart's catalogue. Returns in-stock products priced in naira for the shopper's location (prices are whole naira: 55000 = ₦55,000). An empty list means nothing matched.",
    inputSchema: {
      query: z.string().describe("Keywords describing the product."),
      category: z.string().optional().describe("Product category filter if applicable."),
      color: z.string().optional().describe("Color filter."),
      min_price: z.number().optional().describe("Minimum price filter."),
      max_price: z.number().optional().describe("Maximum price filter."),
      sort_by: z.enum(["relevance", "price_asc", "price_desc", "popular"]).optional(),
    },
    readOnly: true,
  },
  manage_cart: {
    description:
      "View or change the shopper's Ceedmart cart. ADD needs product_id, and size when the product lists several available_sizes. Problems the shopper should hear about (out of stock, size not offered, …) come back as `error` beside the unchanged cart.",
    inputSchema: {
      action: z.enum(["ADD", "REMOVE", "UPDATE_QUANTITY", "VIEW", "CLEAR"]),
      product_id: z.string().optional().describe("Required for ADD, REMOVE, and UPDATE_QUANTITY."),
      size: z.string().optional().describe("Selected size or variant (e.g. '50kg', '5kVA')."),
      quantity: z.number().int().optional().describe("Quantity to add or set (defaults to 1)."),
    },
    readOnly: false,
  },
}

const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true })

/**
 * POST one tool call to the backend. A store-level outcome (including a
 * refusal with `error` beside the cart) is a normal result; a broken backend,
 * a timeout or a bad call is an MCP error, so SmartAI apologises and retries
 * later (requirements §9).
 */
export const forward = async (config, tool, args, meta, fetchImpl = fetch) => {
  const shopperId = typeof meta?.["smartai/shopperId"] === "string" ? meta["smartai/shopperId"] : ""
  if (tool === "manage_cart" && !shopperId) {
    return fail("manage_cart needs _meta[\"smartai/shopperId\"] to know whose cart this is.")
  }
  const started = Date.now()
  let res
  try {
    res = await fetchImpl(`${config.apiUrl}/smartai/tools/${tool}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.backendSecret}`,
      },
      body: JSON.stringify({ args: args ?? {}, shopper_id: shopperId }),
      signal: AbortSignal.timeout(config.timeoutMs ?? TOOL_TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError"
    log(tool, args, shopperId, timedOut ? "timeout" : "unreachable", started)
    return fail(timedOut ? "The Ceedmart store took too long to answer." : "The Ceedmart store is unreachable.")
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    // fall through: not JSON
  }
  if (!res.ok || !body || typeof body !== "object") {
    log(tool, args, shopperId, `http_${res.status}`, started)
    return fail(body?.message ? `Ceedmart store: ${body.message}` : `Ceedmart store error (${res.status}).`)
  }
  log(tool, args, shopperId, body.error?.code ?? "ok", started)
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
  }
}

// Shopper id, tool, action and outcome — no cart contents (requirements §10).
const log = (tool, args, shopperId, outcome, started) =>
  console.log(
    JSON.stringify({
      tool,
      action: args?.action,
      shopper: shopperId || undefined,
      outcome,
      ms: Date.now() - started,
    })
  )

/** A server with exactly the three tools. One per HTTP request (stateless). */
export const createServer = (config, fetchImpl = fetch) => {
  const server = new McpServer({ name: "ceedmart-shopping", version: "0.1.0" })
  for (const [name, def] of Object.entries(TOOLS)) {
    server.registerTool(
      name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: { readOnlyHint: def.readOnly, openWorldHint: false },
      },
      (args, extra) => forward(config, name, args, extra?._meta, fetchImpl)
    )
  }
  return server
}
