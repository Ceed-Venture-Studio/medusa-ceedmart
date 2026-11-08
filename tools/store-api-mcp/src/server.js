#!/usr/bin/env node
// Local entry point: the MCP server over stdio, for an assistant that starts
// it as a subprocess (Claude Code, Claude Desktop, Cursor, VS Code).
// The hosted variant is http.js. Tools and guides live in create-server.js.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createServer } from "./create-server.js"

await createServer().connect(new StdioServerTransport())
