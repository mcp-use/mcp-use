---
name: mcp-builder
description: |
  Build Model Context Protocol (MCP) servers with the mcp-use framework.
  Use when creating MCP servers, defining tools/resources/prompts, working with mcp-use,
  bootstrapping MCP projects, implementing tool handlers, defining resource schemas,
  implementing prompt templates, composing multiple servers via proxy, or when user mentions
  MCP development, server composition, interactive widgets, or resource/prompt design.
---

# MCP Server Builder

Build production-ready MCP servers with tools, resources, prompts, and interactive widgets using mcp-use.

## Before You Code

Decompose user requests into tools, widgets, and resources. Decide what needs UI vs text.

Read [design-and-architecture.md](references/design-and-architecture.md): when planning what to build, deciding tool vs widget, or designing UX flows.

## Implementation

- **Tools, resources, prompts** → [tools-and-resources.md](references/tools-and-resources.md): when writing server-side `server.tool()`, `server.resource()`, `server.prompt()` code
- **Visual widgets (React TSX)** → [widgets.md](references/widgets.md): when creating interactive UI widgets in `resources/` folder
- **Response helper API** → [response-helpers.md](references/response-helpers.md): when choosing how to format tool/resource return values
- **URI template patterns** → [resource-templates.md](references/resource-templates.md): when defining parameterized resources
- **Server proxying & composition** → [proxy.md](references/proxy.md): when composing multiple MCP servers into a unified aggregator

## Quick Reference

```typescript
import { MCPServer, text, object, markdown, html, image, widget, error } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({ name: "my-server", version: "1.0.0" });

// Tool
server.tool(
  { name: "my-tool", description: "...", schema: z.object({ param: z.string().describe("...") }) },
  async ({ param }) => text("result")
);

// Resource
server.resource(
  { uri: "config://settings", name: "Settings", mimeType: "application/json" },
  async () => object({ key: "value" })
);

// Prompt
server.prompt(
  { name: "my-prompt", description: "...", schema: z.object({ topic: z.string() }) },
  async ({ topic }) => text(`Write about ${topic}`)
);

server.listen();
```

**Response helpers:** `text()`, `object()`, `markdown()`, `html()`, `image()`, `audio()`, `binary()`, `error()`, `mix()`, `widget()`

**Server methods:**
- `server.tool()` - Define executable tool
- `server.resource()` - Define static/dynamic resource
- `server.resourceTemplate()` - Define parameterized resource
- `server.prompt()` - Define prompt template
- `server.proxy()` - Compose/Proxy multiple MCP servers
- `server.uiResource()` - Define widget resource
- `server.listen()` - Start server

## Validation & Testing

After implementing, verify the server works correctly:

```bash
npx mcp-inspector
```

Use the inspector to confirm tools, resources, and prompts are registered correctly, inputs/outputs match expected schemas, and error responses are handled gracefully.

**If validation fails, follow these recovery steps:**

- **Tool/resource/prompt not listed in inspector**
  - Verify the `server.tool()` / `server.resource()` / `server.prompt()` call is present and executes at startup (not inside a conditional or async block that hasn't resolved)
  - Confirm `server.listen()` is called after all registrations
  - Restart the inspector and reconnect

- **Schema validation error on invocation**
  - Cross-check the Zod schema with the inspector's generated input form — field names and types must match exactly
  - Ensure `.describe()` is present on required fields so the inspector can render them

- **Unexpected response shape**
  - Verify the correct response helper is used (e.g., `object()` for JSON, `text()` for plain strings); mismatches cause silent formatting failures
  - Check [response-helpers.md](references/response-helpers.md) for the expected return contract of each helper

- **Error not surfaced to client**
  - Return `error("message")` explicitly rather than throwing — unhandled throws may not propagate correctly to the inspector
