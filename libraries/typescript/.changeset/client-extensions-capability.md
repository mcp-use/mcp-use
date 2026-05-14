---
"mcp-use": minor
---

Add a top-level `capabilities` option on the `MCPClient` and `BrowserMCPClient` configs for advertising client capabilities (`roots`, `sampling`, `elicitation`, `extensions`, etc.) during the MCP initialize handshake.

The shape mirrors the wire format exactly, so any present or future field defined under the spec's `ClientCapabilities` object can be configured here — including SEP-1724 `extensions` such as MCP Apps (SEP-1865).

The connector continues to auto-manage `roots` (always advertised) plus `sampling`/`elicitation` when their callbacks are registered; values supplied at those specific keys may be overridden by the auto-managed fields, but everything else (notably `extensions`) passes through unchanged.

A new `mcpApps()` helper returns the canonical SEP-1865 fragment (`{ "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } }`), and the `MCP_APPS_EXTENSION_ID` / `MCP_APPS_MIME_TYPE` constants are exported for downstream use.

Also fixes a latent gap where the Node `MCPClient` was not forwarding custom `clientOptions` to `StdioConnector` at all.

```ts
import { MCPClient, mcpApps } from "mcp-use";

const client = new MCPClient({
  capabilities: {
    extensions: mcpApps(),
  },
  mcpServers: {
    widget: { url: "https://example.com/mcp" },
  },
});
```
