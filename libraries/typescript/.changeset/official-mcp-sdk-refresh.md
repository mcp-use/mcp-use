---
"@mcp-use/client": patch
"@mcp-use/agent": patch
"@mcp-use/cli": patch
"mcp-use": patch
---

Update the official MCP client, core, and server SDKs to 2.3.1 and MCP Apps to 2.0.3. Preserve the server response-detection patch and update the legacy SDK used by agent test servers to 1.32.1.

The upstream HTTP and OAuth helpers now restrict redirects. On Node, only same-origin redirects that preserve the request method are followed. Browsers reject all redirects by default, including same-origin redirects. Configure endpoints with their final URL; mcp-use's HTTP connector does not expose the upstream `redirectPolicy` option. Existing issuer-bound OAuth storage and standard error causes remain supported.
