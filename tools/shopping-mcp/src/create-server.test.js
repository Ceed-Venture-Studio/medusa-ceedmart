import { test } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createServer } from "./create-server.js"

// The contract SmartAI checks (requirements §4–6 and §11): exactly these
// three tools, every property present, and only these required.
const EXPECTED = {
  get_initial_recommendations: {
    properties: { limit: "integer", category_hint: "string" },
    required: [],
  },
  search_products: {
    properties: {
      query: "string",
      category: "string",
      color: "string",
      min_price: "number",
      max_price: "number",
      sort_by: "string",
    },
    required: ["query"],
  },
  manage_cart: {
    properties: { action: "string", product_id: "string", size: "string", quantity: "integer" },
    required: ["action"],
  },
}

const connect = async (fetchImpl, config = {}) => {
  const server = createServer(
    { apiUrl: "https://api.test", backendSecret: "s".repeat(40), timeoutMs: 200, ...config },
    fetchImpl
  )
  const client = new Client({ name: "smartai-test", version: "0" })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

const okFetch = (body, calls = []) => async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) })
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

test("lists exactly the three tools with SmartAI's schemas", async () => {
  const client = await connect(okFetch({}))
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(EXPECTED).sort())
  for (const tool of tools) {
    const want = EXPECTED[tool.name]
    const props = tool.inputSchema.properties ?? {}
    assert.deepEqual(Object.keys(props).sort(), Object.keys(want.properties).sort(), tool.name)
    for (const [name, type] of Object.entries(want.properties)) {
      assert.equal(props[name].type, type, `${tool.name}.${name}`)
    }
    assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), want.required, `${tool.name} required`)
  }
  const tools2 = Object.fromEntries(tools.map((t) => [t.name, t]))
  assert.deepEqual(tools2.search_products.inputSchema.properties.sort_by.enum, ["relevance", "price_asc", "price_desc", "popular"])
  assert.deepEqual(tools2.manage_cart.inputSchema.properties.action.enum, ["ADD", "REMOVE", "UPDATE_QUANTITY", "VIEW", "CLEAR"])
  assert.equal(
    tools2.get_initial_recommendations.inputSchema.properties.limit.description,
    "Number of products to return (default 4, max 6)."
  )
})

test("forwards args and the shopper id, and returns the backend body as structuredContent", async () => {
  const calls = []
  const body = { cart: { item_count: 0, subtotal: 0, currency: "NGN", items: [] } }
  const client = await connect(okFetch(body, calls))
  const res = await client.callTool({
    name: "manage_cart",
    arguments: { action: "VIEW" },
    _meta: { "smartai/shopperId": "shopper_1", "smartai/sessionId": "s", "smartai/turnId": "t" },
  })
  assert.equal(res.isError, undefined)
  assert.deepEqual(res.structuredContent, body)
  assert.deepEqual(JSON.parse(res.content[0].text), body)
  assert.equal(calls[0].url, "https://api.test/smartai/tools/manage_cart")
  assert.equal(calls[0].init.headers.authorization, `Bearer ${"s".repeat(40)}`)
  assert.deepEqual(calls[0].body, { args: { action: "VIEW" }, shopper_id: "shopper_1" })
})

test("a store refusal is a normal result, not an MCP error", async () => {
  const body = {
    cart: { item_count: 0, subtotal: 0, currency: "NGN", items: [] },
    error: { code: "out_of_stock", message: "Rice 50kg is out of stock in Rivers." },
  }
  const client = await connect(okFetch(body))
  const res = await client.callTool({
    name: "manage_cart",
    arguments: { action: "ADD", product_id: "prod_1", size: "50kg" },
    _meta: { "smartai/shopperId": "shopper_1" },
  })
  assert.equal(res.isError, undefined)
  assert.equal(res.structuredContent.error.code, "out_of_stock")
})

test("manage_cart without a shopper id is an MCP error and never reaches the store", async () => {
  const calls = []
  const client = await connect(okFetch({}, calls))
  const res = await client.callTool({ name: "manage_cart", arguments: { action: "VIEW" } })
  assert.equal(res.isError, true)
  assert.equal(calls.length, 0)
})

test("product tools work without a shopper id", async () => {
  const calls = []
  const client = await connect(okFetch({ products: [] }, calls))
  const res = await client.callTool({ name: "search_products", arguments: { query: "rice" } })
  assert.deepEqual(res.structuredContent, { products: [] })
  assert.deepEqual(calls[0].body, { args: { query: "rice" }, shopper_id: "" })
})

test("a backend failure or timeout is an MCP error", async () => {
  const down = await connect(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }))
  const r1 = await down.callTool({ name: "get_initial_recommendations", arguments: {} })
  assert.equal(r1.isError, true)
  assert.match(r1.content[0].text, /boom/)

  const slow = await connect(
    (url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason))
      )
  )
  const r2 = await slow.callTool({ name: "get_initial_recommendations", arguments: { limit: 2 } })
  assert.equal(r2.isError, true)
  assert.match(r2.content[0].text, /too long/)
})
