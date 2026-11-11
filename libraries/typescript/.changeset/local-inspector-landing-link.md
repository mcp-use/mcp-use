---
"mcp-use": patch
"@mcp-use/cli": patch
---

Link the landing page to the server's Inspector only when the CLI has mounted it. Pass its request-resolved URL through landing data and the optional `inspectorUrl` input to `getInstallTargets()`, keeping the hosted Inspector fallback for plain servers, `dev --no-inspector`, and `start` without `--with-inspector`. Mounted links prefill the MCP endpoint and open the Chat tab.
