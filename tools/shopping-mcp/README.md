# Ceedmart shopping MCP

The MCP server SmartAI's shopping assistant connects to. It exposes exactly
three tools — `get_initial_recommendations`, `search_products`,
`manage_cart` — with the names and input schemas from SmartAI's
"Ceedmart MCP Requirements for the SmartAI Shopping Assistant" (19 Nov 2026).

All Ceedmart logic lives in the Medusa backend (`app/ceedmart/src/lib/smartai`,
`POST /smartai/tools/<name>`): pricing for the state, availability, stock,
listing types, and each shopper's guest cart. This server only forwards a call
with a 7 s timeout and returns the backend's answer as `structuredContent`.
Design: `app/ceedmart/docs/smartai-shopping-mcp-design.md`.

This is **not** `tools/store-api-mcp` (the developer gateway with
`call_store_api`). The two never share a URL or a token.

## Run

```
npm ci
MCP_ACCESS_TOKEN=…  CEEDMART_API_URL=https://…  SMARTAI_BACKEND_SECRET=…  npm start
npm test
```

| Variable | Meaning |
|---|---|
| `MCP_ACCESS_TOKEN` | Bearer SmartAI sends (`Authorization: Bearer …`), 32+ characters |
| `CEEDMART_API_URL` | Medusa backend for this environment |
| `SMARTAI_BACKEND_SECRET` | Bearer this server sends to `/smartai/*`; same value as the backend's `SMARTAI_BACKEND_SECRET` |

Endpoints: `POST /mcp` (Streamable HTTP, stateless), `GET /health`.

## Behaviour

- `manage_cart` needs `_meta["smartai/shopperId"]`; without it the call is an
  MCP error and never reaches the store.
- A store refusal (out of stock, size not offered, …) is a normal result with
  `error` beside the cart. A backend failure or timeout is an MCP error
  (`isError: true`), which SmartAI answers with an apology.
- Logs one JSON line per call: tool, action, shopper id, outcome, duration.
  No cart contents.

## Deploy (Cloud Run)

```
gcloud builds submit --tag europe-west1-docker.pkg.dev/ceedmart/ceedmart-docker/shopping-mcp:<tag> .
gcloud run deploy ceedmart-shopping-mcp-staging \
  --image=europe-west1-docker.pkg.dev/ceedmart/ceedmart-docker/shopping-mcp:<tag> \
  --region=europe-west1 --allow-unauthenticated \
  --set-env-vars=CEEDMART_API_URL=…,MCP_ACCESS_TOKEN=…,SMARTAI_BACKEND_SECRET=…
```

`--allow-unauthenticated` lets SmartAI reach it; the bearer token is the gate.
The backend must have the same `SMARTAI_BACKEND_SECRET` (in
`app/ceedmart/.env.<env>`). While SmartAI tests against staging, keep the
staging API at one minimum instance: a cold Medusa start is far over
SmartAI's 8 s limit.

## Verify

As SmartAI does (requirements §11): point the MCP Inspector
(`npx @modelcontextprotocol/inspector`) at `<url>/mcp` with the token; expect
exactly three tools; call `get_initial_recommendations` with `{"limit":2}`;
`manage_cart` ADD for one shopper id, then VIEW for it and for another
(empty); every call under 8 s.
