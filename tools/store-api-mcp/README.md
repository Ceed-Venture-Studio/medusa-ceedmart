# Ceedmart store API — MCP server

An MCP server for building the Ceedmart mobile app. It plugs into your AI
coding assistant (Claude Code, Claude Desktop, Cursor, VS Code) and gives it:

- **The API reference:** every store endpoint the app uses, with parameters,
  responses and the Ceedmart-specific rules.
- **Integration guides:** sign-in, catalog and city pricing, cart and
  checkout, payments, orders, errors.
- **Live calls to staging:** the assistant can make real requests to the
  staging backend to check a request shape or run a checkout end to end.

Staging holds anonymised data, takes no real payments and sends no email or
SMS, so nothing you do there reaches a real customer.

## Connect (hosted — nothing to install)

You need two things from the Ceedmart team:

- **URL:** `https://ceedmart-store-mcp-870514614467.europe-west1.run.app/mcp`
- **Access token:** sent to you separately. Keep it out of source control.

### Claude Code

```bash
claude mcp add --transport http ceedmart-store \
  https://ceedmart-store-mcp-870514614467.europe-west1.run.app/mcp \
  --header "Authorization: Bearer <access token>"
```

Check it with `claude mcp list` (it should say "Connected"), or `/mcp`
inside a session.

### Claude Desktop

Claude Desktop's connector settings cannot send a custom header, so add the
server through the config file (Settings → Developer → Edit Config) and
bridge it with `mcp-remote`, which needs Node.js 18+:

```json
{
  "mcpServers": {
    "ceedmart-store": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://ceedmart-store-mcp-870514614467.europe-west1.run.app/mcp",
        "--header", "Authorization: Bearer <access token>"
      ]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in the project):

```json
{
  "mcpServers": {
    "ceedmart-store": {
      "url": "https://ceedmart-store-mcp-870514614467.europe-west1.run.app/mcp",
      "headers": { "Authorization": "Bearer <access token>" }
    }
  }
}
```

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "ceedmart-store": {
      "type": "http",
      "url": "https://ceedmart-store-mcp-870514614467.europe-west1.run.app/mcp",
      "headers": { "Authorization": "Bearer <access token>" }
    }
  }
}
```

The server sleeps when idle; the first call after a quiet spell takes a few
seconds longer.

## Try it

Ask your assistant things like:

- "Use the Ceedmart MCP: get the environment and read the overview guide."
- "Show me how to register a customer, then do it on staging with a test
  email."
- "Run a full checkout on staging for Palm Oil in Lagos with bank transfer,
  and show me each request and response."
- "What does a product look like in Lagos versus Port Harcourt? Call the API
  for both."
- "Write a Kotlin/Swift/Dart client for the cart endpoints from the catalog."

## Tools

| Tool | What it does |
|---|---|
| `get_environment` | Base URL, publishable key, regions and the city → sales channel → state map. Call it first. |
| `list_endpoints` | The endpoint catalog, filterable by group or keyword. |
| `get_endpoint` | One endpoint in full: auth, parameters, response, Ceedmart rules. |
| `get_guide` | A guide: `overview`, `quickstart`, `auth`, `catalog-and-locations`, `cart-and-checkout`, `payments`, `orders`, `errors`, `staging`. |
| `call_store_api` | A real request to the staging store API. The publishable key is added for you; pass `customer_token` for signed-in calls. |

The guides and the full catalog are also exposed as MCP resources
(`ceedmart://guides/<topic>`, `ceedmart://catalog/endpoints.json`).

## Safety limits on live calls

- Only shopper-facing paths: `/store/*`, `/auth/customer/*`,
  `/auth/token/refresh`. Admin and PoS endpoints are refused.
- Only the staging backend by default. Pointing the server elsewhere
  (`CEEDMART_API_URL`) turns live calls off, unless you also set
  `CEEDMART_ALLOW_PRODUCTION=read-only`, which still allows GET requests only.

## Configuration (local runs)

All optional; the defaults point at staging. The hosted server always uses staging.

| Variable | Default | Meaning |
|---|---|---|
| `CEEDMART_API_URL` | staging URL | Backend base URL |
| `CEEDMART_PUBLISHABLE_KEY` | staging mobile key | Key sent as `x-publishable-api-key` |
| `CEEDMART_ALLOW_PRODUCTION` | unset | `read-only` allows GET calls outside staging |


## Staging facts

- Base URL: `https://ceedmart-api-staging-870514614467.europe-west1.run.app`
- Publishable key: `pk_e1710ced4688fa8f22c119a9ba620273d3830e60d21342f87b226313eee3f2b2`
- Online payment (Pulse Pay) is not connected on staging; place test orders
  with the bank-transfer method. Details: `get_guide payments`.
- The first request after a quiet spell can take 1–3 minutes while staging
  starts up.

## For the Ceedmart team

### Running it locally instead

`npm install`, then point a client at the stdio server:
`claude mcp add ceedmart-store -- node /absolute/path/to/store-api-mcp/src/server.js`.
Local runs need no access token. `npm run start:http` serves the hosted
variant on `$PORT` and requires `MCP_ACCESS_TOKEN`.

### Hosting

Cloud Run service `ceedmart-store-mcp` (europe-west1), scale-to-zero, 256 MiB.
The image is built from this folder's Dockerfile into the `ceedmart-docker`
registry. The access token is the service's `MCP_ACCESS_TOKEN` environment
variable; to rotate it, redeploy with a new value and send it to the
developer.

### Content

The catalog lives in `src/catalog/endpoints.json` and the guides in
`src/guides/`. Update them when the store API changes. `npm test` checks the
live-call safety rules.
