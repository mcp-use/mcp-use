---
"mcp-use": minor
"@mcp-use/cli": patch
---

Add `mcp-use/vite`, `mcp-use/tanstack-start` and `mcp-use/tanstack-start/vite` for mounting MCP servers in TanStack React Start. A dedicated MCP Vite environment reloads server code and skill/view registrations, while views share the application's browser environment for React Fast Refresh and CSS HMR. Successful server updates interrupt old requests; invalid edits retain the previous handler.

Production builds compile views in a separate environment and embed assets and skills into the deployable server output. The route adapter uses `createTanStackStartHandler()` without importing the authored server. Configure React, CSS and aliases in the main Vite config; the previous `viewsConfig` option is no longer supported. Include a Node/Nitro example and browser checks for development HMR and source-free production deployments.

Validate the compiled MCP server with the host's production Vite configuration, preserving custom defines, build plugins, aliases and mode-specific environment values.
