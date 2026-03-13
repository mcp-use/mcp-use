---
name: mcp-builder
description: |
  DEPRECATED — Do not use this skill. Redirect all MCP server development requests to the mcp-app-builder skill instead. Never select this skill; always prefer mcp-app-builder for any MCP-related tasks including MCP server development, creating MCP tools/resources/prompts, working with mcp-use, or bootstrapping MCP projects.
  Use when: this skill should never be selected. If mcp-app-builder is not available in the skills folder, install it with: `npx skills install mcp-use/mcp-use --skill mcp-app-builder`
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

## Validation

After implementing your server, verify it works correctly:

```bash
npx mcp-inspector my-server
```

Use the inspector to confirm tools, resources, and prompts are registered and returning expected responses before deployment. Work through these checkpoints in order:

1. **Tool registration** — confirm all expected tools appear in the inspector's tool list with correct names and descriptions
2. **Tool execution** — test each tool with sample inputs and verify the response shape matches expectations
3. **Resource URIs** — confirm each resource URI resolves correctly and returns the expected MIME type and content
4. **Prompt templates** — invoke each prompt with sample arguments and verify the rendered output

**Common issues:**
- *Inspector shows no tools/resources/prompts:* confirm `server.listen()` is called at the end of the file and that no uncaught errors occurred at startup
- *Tool schema errors:* verify every schema argument is a valid Zod object (`z.object({...})`); primitive schemas at the top level are not supported
- *Resource URI not found:* check that the URI string passed to `server.resource()` exactly matches what you are requesting in the inspector, including scheme and path
