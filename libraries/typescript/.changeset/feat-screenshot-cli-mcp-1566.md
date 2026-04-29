---
"@mcp-use/cli": minor
"@mcp-use/inspector": minor
---

feat(cli, inspector): add `mcp-use screenshot` for visual feedback loops on MCP Apps views (MCP-1566)

`mcp-use screenshot --tool <name> --args '<json>'` calls the tool and renders the result headlessly, saving a PNG of the resulting view.

The CLI auto-spawns `mcp-use dev` if no server is detected, drives Playwright at a new chromeless `/inspector/preview/:view` route inside the inspector SPA, and tears the dev server down on exit. Output defaults to `./<view>-<hash>.png` in cwd, where `<hash>` is a stable 6-char hash of `props + theme` so re-running with the same inputs overwrites the same file.

Playwright is an optional peer dep — `mcp-use screenshot --install` fetches it (and the Chromium binary) on demand.

The inspector exposes a new internal `<ViewPreview>` component and a `/preview/:view` client-side route. `MCPAppsRenderer` gains an optional `onReady` callback used by the preview route to drive the readiness signal (`body[data-view-ready="true"]`) that Playwright waits for before screenshotting.
