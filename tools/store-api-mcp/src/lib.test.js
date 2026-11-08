import { test } from "node:test"
import assert from "node:assert/strict"
import { checkRequest, truncate } from "./lib.js"

const staging = { isStaging: true, allowProduction: false, apiUrl: "https://x-staging" }
const prod = { isStaging: false, allowProduction: false, apiUrl: "https://api.ceedmart.com" }
const prodRead = { ...prod, allowProduction: true }

test("allows shopper paths on staging", () => {
  for (const path of ["/store/products", "/store/carts/cart_1/line-items", "/auth/customer/emailpass", "/auth/token/refresh"]) {
    assert.equal(checkRequest({ method: "POST", path, config: staging }), null, path)
  }
})

test("refuses admin, pos and other paths", () => {
  for (const path of ["/admin/products", "/pos/sync/catalog/x", "/auth/user/emailpass", "/health", "/storefront"]) {
    assert.match(checkRequest({ method: "GET", path, config: staging }), /Only shopper-facing/, path)
  }
})

test("refuses traversal and inline query strings", () => {
  for (const path of ["/store/../admin/users", "/store//x", "/store/products?limit=1", "store/products"]) {
    assert.notEqual(checkRequest({ method: "GET", path, config: staging }), null, path)
  }
})

test("refuses production unless read-only is switched on, then GET only", () => {
  assert.match(checkRequest({ method: "GET", path: "/store/products", config: prod }), /only enabled against staging/)
  assert.equal(checkRequest({ method: "GET", path: "/store/products", config: prodRead }), null)
  assert.match(checkRequest({ method: "POST", path: "/store/carts", config: prodRead }), /GET requests/)
})

test("truncate keeps short text and marks long text", () => {
  assert.equal(truncate("abc", 10), "abc")
  assert.match(truncate("x".repeat(50), 10), /truncated 40 more characters/)
})
