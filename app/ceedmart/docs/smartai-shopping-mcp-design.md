# SmartAI Shopping MCP — Design

Status: **built 20 Nov 2026** (backend `lib/smartai`, `/smartai/tools/*`; `tools/shopping-mcp`; storefront `/[countryCode]/cart/continue`). Decisions in §7 confirmed.

Implements "Ceedmart MCP Requirements for the SmartAI Shopping Assistant"
(SmartAI, 19 Nov 2026): an MCP server exposing exactly three tools —
`get_initial_recommendations`, `search_products`, `manage_cart` — over
guest carts, one per SmartAI shopper id.

---

## 1. Shape

```
SmartAI ──MCP/HTTPS + bearer A──▶ ceedmart-shopping-mcp ──HTTPS + bearer B──▶ Medusa  /smartai/tools/*
          (3 tools only)          (Cloud Run, stateless,                     (all Ceedmart rules,
                                   ~150 lines: schemas +                      in-process queries,
                                   forward + timeout)                         shopper→cart table)
```

**Why the logic lives in Medusa, not in the MCP:**

- **One hop per tool call.** The 8 s budget (requirement C4) is spent once,
  in-process, instead of on 3–6 store-API round trips per call.
- **The rules already exist there**: state pricing and availability
  (`lib/location-catalog`), listing types (`lib/listing-policy`), variant
  availability (`getVariantAvailability`), and the cart workflow hooks that
  price and validate every cart for its state. Calling them directly cannot
  drift from what the storefront does.
- **Durable shopper→cart map** in the same Postgres, no new infrastructure.
- **Unit-testable** with the existing jest setup.
- Chat searches do not pass through the `/store/products` route, so they are
  not logged as customer searches in Search Insights.

The MCP stays a thin, separate service so the shopping URL exposes only the
three tools (requirement §10) and never shares a URL or token with the
developer gateway (`ceedmart-store-mcp`, which has `call_store_api`).

---

## 2. Backend (`app/ceedmart`)

### 2.1 Routes

| Route | Body | Returns (= the tool's `structuredContent`) |
|---|---|---|
| `POST /smartai/tools/get_initial_recommendations` | `{ args, shopper_id? }` | `{ products }` |
| `POST /smartai/tools/search_products` | `{ args, shopper_id? }` | `{ products, total }` |
| `POST /smartai/tools/manage_cart` | `{ args, shopper_id }` | `{ cart, error? }` |

`args` is the tool input exactly as SmartAI sent it. The response body is
returned to SmartAI unchanged, so the MCP holds no logic.

- **Auth:** `Authorization: Bearer <SMARTAI_BACKEND_SECRET>`, timing-safe
  compare, middleware on `/smartai/*`. Not a publishable key and not an admin
  session: these routes create carts and must not be callable by the public.
  Unset secret → routes answer 503 (feature off).
- **Status codes:** 200 for every *store-level* outcome, including
  `error` beside the cart (§9 of the requirements). 4xx/5xx only for a broken
  call (bad secret, missing shopper id on `manage_cart`, database down), which
  the MCP turns into an MCP error.
- **Unknown arguments are ignored**, never an error.

### 2.2 Configuration (env, per environment)

| Var | Meaning | Default |
|---|---|---|
| `SMARTAI_BACKEND_SECRET` | Bearer the MCP presents (32+ random bytes) | unset = off |
| `SMARTAI_DEFAULT_LOCATION` | Web location id the assistant shops in | `port-harcourt` |
| `SMARTAI_RECOMMEND_TAG` | Product tag that marks recommendations | `Featured` |
| `SMARTAI_MAX_QUANTITY` | Largest quantity per line via chat | `20` |
| `SMARTAI_STOREFRONT_URL` | Site for `product_url` and `checkout_url`; falls back to `STOREFRONT_URL` (staging's is localhost) | unset |

`SMARTAI_DEFAULT_LOCATION` resolves through `WEB_LOCATIONS`
(`lib/web-locations`) to the **city channel** (product listings) and its
**state** (`ng-ri`). Carts always use the **default channel** with
`metadata.ceedmart.province` — never the city channel (correction to §8 of
the requirements; see `tools/store-api-mcp/src/guides/05-cart-and-checkout.md`).

### 2.3 Data: `smartai` module

```
smartai_shopper_cart
  id            text pk          ("ssc_…")
  shopper_id    text not null    unique (where deleted_at is null)
  cart_id       text not null
  created_at / updated_at / deleted_at
```

- Created on the first `ADD` only (`VIEW` never creates anything).
- Two parallel first `ADD`s for one shopper: the unique index makes one insert
  lose; the loser re-reads and uses the winner's cart (its own empty cart is
  left unused).
- A mapped cart that is completed (`completed_at`) or no longer exists is
  treated as "no cart"; the next `ADD` creates a new one and repoints the row.
- The cart itself also carries `metadata.ceedmart.smartai_shopper_id`
  (merged into `metadata.ceedmart`, never replacing it) for support lookups.

### 2.4 Shared rules (`lib/smartai/`, pure + tested)

**Purchasable at the location.** A variant can be bought via chat when all of:

1. its product is `published` and linked to the location's city channel;
2. its listing policy is `standard` and active (pre-orders, custom builds and
   auctions are **left out** of both product tools and refused by
   `manage_cart` with `not_purchasable`);
3. it is `available_here` for the state (`lib/location-catalog`);
4. it is in stock — the storefront's rule: `manage_inventory` off, **or**
   `allow_backorder`, **or** available quantity > 0 for the channel.

**Product shape** (requirement §7):

| Field | Source |
|---|---|
| `product_id` | `product.id` |
| `name` | `product.title` |
| `price` | cheapest purchasable variant's `calculated_price.calculated_amount` for the state — whole naira as stored, includes sale price lists (e.g. Black Friday) |
| `currency` | `"NGN"` |
| `category` | first category name |
| `image_url` | `product.thumbnail` (public https) |
| `available_sizes` | option-value label of each purchasable variant (§2.5); `[]` for a single-variant product |
| `in_stock` | always `true` — only purchasable products are returned |
| `product_url` | `${STOREFRONT_URL}/ng/products/${handle}` |
| `description` | plain text, HTML stripped, ≤ 500 chars |

**Cart shape** (requirement §7): from the Medusa cart — `item_count` = sum of
quantities; `subtotal` = `cart.item_subtotal` after discounts as Medusa
computes it (never recomputed); each item maps `product_id`, `product_title`,
size label, `quantity`, `unit_price`, `total`, `thumbnail`.

### 2.5 Sizes

A size label is the variant's **option values**, joined with " / " when a
product has several options, e.g. `"1 Carton(20 Pieces)"`, `"Black / 128GB"`.

- Production check (19 Nov): option-value labels are unique within every
  published product; variant **titles are not** (33 products repeat a title),
  so titles are never used.
- Matching `size` from the model: exact label first, then case- and
  whitespace-insensitive. No fuzzy matching — a miss is `bad_size` with the
  valid labels in the message.
- Single-variant products (option "Default …"): `available_sizes: []`, and any
  `size` sent is ignored.

### 2.6 Tools

**`get_initial_recommendations({ limit = 4 (1–6), category_hint? })`**

1. Candidates: published products tagged `SMARTAI_RECOMMEND_TAG`, newest
   first; if `category_hint` matches a category, restrict to it.
2. Keep purchasable ones (§2.4), up to `limit`.
3. Top up from the newest purchasable products (same category if hinted) so
   the answer is never empty while the catalogue is not.

**`search_products({ query, category?, color?, min_price?, max_price?, sort_by? })`**

1. `q = query` over title/description (product module search), limited to the
   city channel; `category` (if it matches a category name, case-insensitive,
   including sub-categories) narrows it; `color` is accepted and ignored in v1.
2. Price and price filters use the shopper's price (§2.4), in naira.
3. Sort: `relevance` = search order; `price_asc` / `price_desc` on `price`;
   `popular` = by units sold in the last 90 days (order line items), falling
   back to relevance.
4. Return up to 10, plus `total` before the cap. No match → `{ products: [] }`.

Word matching: one search per meaningful word (≤ 5); products matching every
word win; if none does, a product must match at least half the words, so one
stray word ("warp drive inverter") returns nothing rather than a category.

**`manage_cart({ action, product_id?, size?, quantity? })`** — `shopper_id` from
`_meta["smartai/shopperId"]`.

| Action | Behaviour |
|---|---|
| `VIEW` | Mapped cart, or an empty cart. No side effects. |
| `ADD` | Resolve product → variant (`size`); refuse if not purchasable. Create the cart on first add (default channel, NGN region, `metadata.ceedmart = { province, smartai_shopper_id }`). If the variant is already a line, raise its quantity; else add a line. Quantity 1–`SMARTAI_MAX_QUANTITY`. |
| `REMOVE` | Remove the product's line; if the cart holds several sizes and no `size` was sent → `size_required`. |
| `UPDATE_QUANTITY` | Set the line's quantity (≥ 1); same `size_required` rule. |
| `CLEAR` | Delete every line; keep the cart and the mapping. |

All changes go through Medusa's cart workflows (`addToCartWorkflow`,
`updateLineItemInCartWorkflow`, `deleteLineItemsWorkflow`), so the existing
hooks price the cart for the state and refuse what cannot be sold there.

**Error codes** (returned beside the unchanged cart; message written for a
shopper, may be read aloud):

| Code | When |
|---|---|
| `unknown_product` | id unknown or not published |
| `not_purchasable` | pre-order, custom build or auction |
| `not_available_here` | not sold in the default state |
| `out_of_stock` | no stock at the location |
| `insufficient_stock` | fewer than asked; message says how many are available |
| `bad_size` | size missing (product has several) or not offered |
| `size_required` | REMOVE/UPDATE with several sizes of the product in the cart |
| `not_in_cart` | REMOVE/UPDATE for a product not in the cart |
| `bad_quantity` | outside 1–`SMARTAI_MAX_QUANTITY` |

A workflow error that is not one of these (e.g. database unavailable) is a
5xx → MCP error → SmartAI apologises.

---

## 3. Shopping MCP (`tools/shopping-mcp`)

- Node 20, `@modelcontextprotocol/sdk` 1.32, same structure as
  `tools/store-api-mcp`: `http.js` (Streamable HTTP, stateless, bearer
  `MCP_ACCESS_TOKEN`, `/health`), `create-server.js` (the three tools).
- Tool names and input schemas **exactly** as in requirements §4–6 (all
  properties present, only `query` / `action` required). Schemas are checked
  by a test against the JSON in the requirements.
- Each handler: read `extra._meta["smartai/shopperId"]` (also session/turn
  ids for logs), POST `{ args, shopper_id }` to
  `${CEEDMART_API_URL}/smartai/tools/<name>` with `SMARTAI_BACKEND_SECRET`,
  **7 s timeout**; return the body as `structuredContent` (and as JSON text in
  `content`). Non-2xx or timeout → `isError: true`.
- `manage_cart` without a shopper id → `isError` (SmartAI always sends one).
- Logs: tool, action, shopper id, result/error code, duration. No cart
  contents.

---

## 4. Deployment

| | Staging | Production |
|---|---|---|
| MCP service | `ceedmart-shopping-mcp-staging` | `ceedmart-shopping-mcp` |
| Calls | `ceedmart-api-staging` | `ceedmart-api` |
| Min instances (MCP) | 0 | 1 |
| API min instances | **1 while SmartAI tests** (cold Medusa start ≫ 8 s) | already 1 |
| Tokens | own `MCP_ACCESS_TOKEN` + `SMARTAI_BACKEND_SECRET` | different values |

`SMARTAI_*` vars are added to `.env.staging` / `.env.production` (the deploy
script replaces the whole env block). The token shared with SmartAI on
19 Nov 2026 belongs to `ceedmart-store-mcp` and is rotated separately.

---

## 5. Checkout handoff (recommended for v1)

The requirements end v1 at the cart (their D7), but a chat cart is invisible
to the shopper's browser or app, so nothing built in chat could be paid for.
Smallest fix:

- `manage_cart` adds `checkout_url` to the cart:
  `${STOREFRONT_URL}/ng/cart/continue?cart=<cart_id>` (extra field; SmartAI
  reads only the fields it knows — to confirm with SmartAI).
- Storefront route `/[countryCode]/cart/continue` sets the cart cookie for
  that id and redirects to the cart page. A Medusa cart id is already the
  bearer for a guest cart, so this grants nothing the id did not.

Needs a storefront change and confirmation from SmartAI that the assistant
can show the link.

---

## 6. Tests and verification

- **Unit (jest, backend):** purchasable rule, product/cart shapes, size
  labels and matching, sort/price filters, error mapping, shopper-map race.
- **Unit (node:test, MCP):** schemas match the requirements' JSON exactly;
  forwarding, timeout → `isError`.
- **Staging self-test** (requirements §11): MCP Inspector lists exactly three
  tools; `get_initial_recommendations {limit:2}`; ADD for `test_a`, VIEW for
  `test_a` and `test_b`; each call timed, cold and warm.
- Then SmartAI's verify against the staging URL.

---

## 7. Decisions (confirmed 20 Nov 2026)

| # | Decision | Proposed |
|---|---|---|
| D1 | Who builds | Ceedmart (this design) |
| D2 | Default location | Port Harcourt (`ng-ri`) — nearly all orders/carts with a state since 1 Oct |
| D3 | Recommendations | Products tagged **Featured** (15 today), topped up with newest in stock |
| D4 | Sizes | Option values (§2.5) |
| D5 | SmartAI staging access | Only through the staging shopping MCP URL + token |
| D7 | Checkout handoff | In v1 (§5), pending SmartAI confirming the link can be shown |
| — | `popular` sort | Units sold in the last 90 days |
| — | Max quantity | 20 (SmartAI's cap); ask SmartAI whether it can be raised per business |

## 8. Build order

1. Backend: `smartai` module + migration, `lib/smartai` rules + tests,
   `/smartai/tools/*` routes + auth.
2. `tools/shopping-mcp` + tests.
3. Deploy both to staging; API min instances 1; self-test.
4. Checkout handoff (storefront route) if D7 agreed.
5. SmartAI verify on staging → production.
