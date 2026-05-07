---
"@mcp-use/cli": minor
"@mcp-use/inspector": minor
---

feat(cli, inspector): add `mcp-use screenshot` for visual feedback loops on MCP Apps views (MCP-1566)

`mcp-use screenshot --tool <name> --args '<json>'` calls the tool and renders the result headlessly, saving a PNG of the resulting view.

The CLI auto-spawns `mcp-use dev` if no server is detected, drives the user's existing Chrome / Chromium / Edge / Brave install via the Chrome DevTools Protocol at a new chromeless `/inspector/preview/:view` route inside the inspector SPA, and tears the dev server down on exit. Output defaults to `./<view>-<timestamp>.png` in cwd.

No additional install step or peer dependency is required — the command uses your system Chrome. The browser path is auto-detected on macOS / Linux / Windows; override with `MCP_USE_CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, or `CHROME_PATH` if needed.

The inspector exposes a new internal `<ViewPreview>` component and a `/preview/:view` client-side route. `MCPAppsRenderer` gains an optional `onReady` callback used by the preview route to drive the readiness signal (`body[data-view-ready="true"]`) that the screenshot command waits for before capturing.
