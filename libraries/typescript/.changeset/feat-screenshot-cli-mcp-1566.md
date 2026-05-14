---
"@mcp-use/cli": minor
"@mcp-use/inspector": minor
---

feat(cli, inspector): add `mcp-use screenshot` for visual feedback loops on MCP Apps views (MCP-1566)

`mcp-use screenshot --tool <name> key=value [key2=value2 ...]` calls the tool and renders the result headlessly, saving a PNG of the resulting view. Use `key:=<json>` for nested values, or pass a single JSON object for the legacy form.

The CLI always spawns a fresh `@mcp-use/inspector` standalone server on a free port (no reuse of whatever happens to be on `localhost:3000`, which could be an unrelated Vite/dev server) and tears it down on exit. It drives the user's existing Chrome / Chromium / Edge / Brave install via the Chrome DevTools Protocol at the new chromeless `/inspector/preview/:view` route inside the inspector SPA. Pass `--inspector <url>` to point at an existing inspector instance; the URL is probed strictly (must return `{ status: "ok" }` JSON on `/inspector/health`) so unrelated servers can't be misidentified. The screenshot pipeline no longer requires being in a project with an MCP server entry — any directory works. Output defaults to `./<view>-<timestamp>.png` in cwd.

No additional install step or peer dependency is required — the command uses your system Chrome. The browser path is auto-detected on macOS / Linux / Windows; override with `MCP_USE_CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, or `CHROME_PATH` if needed.

The inspector exposes a new internal `<ViewPreview>` component and a `/preview/:view` client-side route. `MCPAppsRenderer` gains an optional `onReady` callback used by the preview route to drive the readiness signal (`body[data-view-ready="true"]`) that the screenshot command waits for before capturing.

**Session-aware authentication.** Screenshot now reuses sessions saved by `mcp-use client connect`, so a single OAuth flow covers every subsequent screenshot of that server. Replace `--auth <token>` with `--session <name>` (defaults to the active session); `--mcp <url>` remains as an unauthenticated escape hatch. The OAuth token never enters the browser — the CLI calls the tool, reads the widget resource, and injects the result into Chrome via CDP `Page.addScriptToEvaluateOnNewDocument` (as `globalThis.__mcpUsePreviewBundle`). The preview route detects the global and renders inline, skipping the browser-side MCP connection entirely.

**Breaking:** `mcp-use screenshot` flags `--auth` and `--header` are removed. Use `mcp-use client connect <url> --name <name>` (with OAuth) once, then `mcp-use screenshot --tool <name>`.

**Auto-screenshot in `client tools call`.** When `mcp-use client tools call <name>` invokes a tool that declares a UI resource (`_meta.ui.resourceUri` or `openai/outputTemplate`), the CLI now automatically captures a widget screenshot using the same pipeline as `mcp-use screenshot`. The tool result is reused (no double tool-call) and the dev server is auto-spawned if needed. Pass `--no-screenshot` to opt out, or `--screenshot-output <path>` to override the default `./<view>-<timestamp>.png` path. Screenshot failures print a warning but don't fail the tool call.

**Remote browser via `--cdp-url`.** `mcp-use screenshot` now accepts `--cdp-url <ws-or-wss-url>` to connect to an existing Chrome DevTools Protocol endpoint instead of spawning local Chrome. Useful for hosted Chromium providers (e.g. Notte) so the screenshot pipeline can run in sandboxes without a local browser install. When `--cdp-url` is set, the CLI skips Chrome resolution entirely and uses `Target.setAutoAttach` (rather than the local path's explicit `Target.attachToTarget`, which some hosted providers forbid) to pick up the existing page session. Combine with `--inspector <url>` pointing at a publicly reachable preview deployment so the remote browser can load the widget bundle. The local-Chrome path is unchanged when `--cdp-url` is omitted.
