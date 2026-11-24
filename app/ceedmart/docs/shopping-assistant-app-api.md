# Shopping Assistant — App API

The three routes the Ceedmart app calls for the shopping assistant chat.
They implement "Shopping Assistant Chat — Mobile App Integration Guide"
(SmartAI, 22 Nov 2026) on the Ceedmart backend. Code: `src/lib/assistant`,
`src/api/store/assistant/*`.

```
app ──▶ Ceedmart backend /store/assistant/* ──▶ SmartAI /api/v3/commerce/chat ──▶ Ceedmart shopping MCP ──▶ backend /smartai/tools/*
        (adds SmartAI key + shopper id)          (runs the conversation)            (catalogue + chat cart)
```

All three are ordinary store routes: send `x-publishable-api-key` as on
every store call. The app never holds a SmartAI key or the MCP token.

## Who is chatting

The backend decides; the app cannot choose a shopper id.

| Shopper | How the app identifies them | Shopper id sent to SmartAI |
|---|---|---|
| Signed in | Its usual customer `Authorization: Bearer <jwt>` | Medusa customer id (`cus_…`) |
| Guest | `x-assistant-guest: <guest_token>` | The guest id in the token (`gst_…`) |

SmartAI passes the id to the shopping MCP unchanged, so it is also the key of
the shopper's chat cart.

## `POST /store/assistant/guest`

Once per app install, for shoppers who chat without signing in.

```json
{ "guest_id": "gst_01M81…", "guest_token": "gst_01M81….<signature>" }
```

Store `guest_token` securely and send it as `x-assistant-guest`. It does not
expire. A guest who signs in starts a new conversation and a new chat cart
(integration guide §5).

## `POST /store/assistant/chat`

```json
{ "session_id": "sess_…", "message": "I need rice", "client_message_id": "<uuid>" }
```

| Field | Rule |
|---|---|
| `message` | `null` (or omitted) when the chat screen opens with no saved session; otherwise the shopper's text, ≤ 2,000 characters |
| `session_id` | Omit on the first call; send the one returned on every later call |
| `client_message_id` | A UUID per message; **reuse it when resending** after a timeout, so the turn runs and is charged once |

**200:** SmartAI's response, unchanged — `reply`, `ui_type`, `products`,
`cart`, `suggested_replies`, `blocks`, `session_id`, `turn_id`, optional
`error` (render the reply anyway). See the integration guide §4–5.

**Errors** (body is always `{ "error": { "code", "message" } }`):

| Status | Code | App does |
|---|---|---|
| 400 | `invalid_request` | Bug or over-long text; cap input at 2,000 |
| 403 | `shopper_required` | Not signed in and no valid guest token: get one from `/guest` |
| 404 | `session_not_found` | Drop the saved session; start again with `message: null` |
| 409 | `request_in_progress` / `session_busy` | Wait 2–3 s, resend with the same `client_message_id` |
| 429 | `rate_limited` | Wait `Retry-After` seconds |
| 503 | `assistant_unavailable` | "The assistant is unavailable right now" |
| 502 | `assistant_unavailable` | "Something went wrong" + Try again (same id) |
| 504 | `assistant_timeout` | Resend with the same id |

This route never answers **401**: SmartAI's key, billing and setup errors
become 503, so they can never look like the shopper's session expiring.
Allow ~50 s for a response (the backend gives SmartAI 45 s).

## `GET /store/assistant/cart`

The cart the assistant built for this shopper, for a "Checkout" button.

```json
{ "cart_id": "cart_01…", "checkout_url": "https://ceedmart.com/ng/cart/continue?cart=cart_01…", "item_count": 2 }
```

Nulls when there is no chat cart. Open `checkout_url` in an in-app browser
to pay on the website (needs the storefront's `/cart/continue` route in
production). Once the app has its own checkout it can load `cart_id`
instead.

## Configuration (backend env)

| Variable | Meaning |
|---|---|
| `SMARTAI_COMMERCE_KEY` | SmartAI business key: `sk_test_…` on staging, `sk_live_…` in production. Unset → chat answers 503 |
| `SMARTAI_BASE_URL` | Defaults to SmartAI's production API |
| `ASSISTANT_GUEST_SECRET` | Signs guest tokens (32+ random bytes). Rotating it invalidates every guest token: guests get a new id, conversation and chat cart |

Separate from `SMARTAI_BACKEND_SECRET`, which the shopping MCP uses to call
`/smartai/tools/*`. Never the same value.

## Logs

One line per message: shopper id, request id, SmartAI status/code, turn id,
our status, duration. Never the shopper's words. SmartAI key, wallet or
registration problems are logged as errors for on-call.
