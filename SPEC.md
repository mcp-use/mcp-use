# `mcp-use screenshot` CLI — SPEC

**Linear:** [MCP-1566](https://linear.app/manufact/issue/MCP-1566/mcp-use-screenshot-cli-visual-feedback-loop-for-widget-development)
**Branch:** `feature/mcp-1566-mcp-use-screenshot-cli-visual-feedback-loop-for-widget`
**Status:** Draft (revised)

> **Terminology:** This spec uses **"view"** — the term used in the MCP spec. The existing mcp-use codebase uses "widget" for the same concept (e.g. `/mcp-use/widgets/:widget`, `MCPAppsRenderer`, `WidgetDebugContext`); those names are preserved when referencing existing code. Renaming existing symbols is explicitly out of scope and deferred to a follow-up PR.

> **Scope:** MCP Apps protocol views only.

## Goal

Add a `mcp-use screenshot` CLI command that renders an MCP Apps view headlessly and saves a PNG.

Use case: **Visual feedback loop for AI assistants** — assistant calls a tool, screenshots the view, visually verifies and self-corrects without human round-trips.

## Architecture

The screenshot CLI is glue code on top of three things that already exist in the repo: the inspector SPA (which already knows how to render views via `MCPAppsRenderer`), the dev server (which already serves the inspector and the view bundles), and the MCP client in `@mcp-use/cli` (which already knows how to call tools). The only new pieces are a chromeless route inside the inspector and a CLI command that drives Playwright at it.

### New route inside the inspector SPA

`@mcp-use/inspector` is already a runtime dependency of `mcp-use` and is auto-mounted at `/inspector` whenever a user runs their MCP server (see `packages/mcp-use/src/server/inspector/mount.ts`). Reuse it.

Add a new route inside the existing inspector React app:

```
GET /inspector/preview/:view?props=<base64-json>&theme=<light|dark>
```

This is a **client-side route** in the inspector SPA's React Router config — not a new server route in `mcp-use` core. The server-side change is limited to confirming the inspector mount's SPA fallback already serves `index.html` for unknown sub-paths under `/inspector/*` (it does — verify in `mountInspectorUI`).

The route renders a chromeless page (no sidebar, no tabs, no props dialog, no server list, no fullscreen button — none of the inspector chrome) that mounts `<ViewPreview>` filling the viewport. The page:

- Renders the view in **fullscreen** `displayMode`, filling the browser viewport. Sizing is controlled by the Playwright browser viewport (set via `--width`/`--height`), not by a wrapping div. See "Width/height semantics" below.
- Sets a known readiness signal on the document once the view has rendered, so Playwright knows when to screenshot. See "View readiness signal" below.

Query/path params:

| Param | Location | Purpose |
|---|---|---|
| `view` | path | Name of the view to render. |
| `props` | query | Base64-encoded JSON containing `toolInput` and `toolOutput` (the resolved tool call result). |
| `theme` | query | `light` or `dark`. Defaults to `light`. Drives `ThemeContext` and is forwarded to the view via the AppBridge host context. |

Width/height are **not** params — sizing is set on the Playwright browser viewport before navigation, and the view fills it via fullscreen mode.

### `<ViewPreview>` component

A thin internal component inside the inspector client (e.g. `packages/inspector/src/client/components/ViewPreview.tsx`). Wraps the existing `MCPAppsRenderer`. **Not a new external sub-export** — the component is consumed only by the inspector's own `/preview/:view` route, so the inspector's `exports` field stays as-is (`.` and `./client`).

The wrapper:

- Reads `view` from the path, decodes `props` from base64 query JSON, reads `theme` from query.
- Mounts `<MCPAppsRenderer noWrapper displayMode="fullscreen" ... />` filling the viewport (`100vw × 100vh`).
- Provides the React contexts the renderer reads from. The inspector SPA already wraps everything in `ThemeContext`, `WidgetDebugContext`, and `McpClientProvider`, so `<ViewPreview>` mostly just consumes them — no new providers, but a couple of context values may need preview-specific overrides (e.g. forcing `theme` to the query-param value rather than user pref). The `McpClientProvider` is already configured against the local dev server in the inspector SPA, so `readResource(uri)` resolves the view's bundled HTML for free.

`displayMode="fullscreen"` is deliberate: `MCPAppsRenderer.tsx:657` short-circuits `onsizechange` for any non-`inline` mode, so view-initiated `setSize()` calls via AppBridge are silently ignored. Sizing is fully driven by the browser viewport — no wrapping div fights the renderer.

Reusing `MCPAppsRenderer` directly keeps the screenshot output identical to how the view renders inside the real inspector — same iframe sandbox, same AppBridge protocol, same CSP enforcement, same host context — provided the wrapper passes through identical props (which it does, except for `displayMode`, hardcoded to `fullscreen`). One consequence worth documenting: a view that is normally `inline` and 400px tall inside inspector will be stretched to the full viewport height in screenshots. This is intentional but should be called out in the user-facing docs.

### CLI command

`packages/cli/src/commands/screenshot.ts`.

**Flags:**

| Flag | Purpose |
|---|---|
| `--width`, `--height` | Browser viewport in pixels — drives the rendered view's size since it renders fullscreen. Default `800×600`. |
| `--server <url>` | MCP server / dev-server URL. Defaults to local dev server. |
| `--theme <light\|dark>` | Color scheme to render the view in. Defaults to `light`. Forwarded to the preview route as `?theme=`. |
| `--output <path>` | Output PNG path. **Optional.** Defaults to `./<view>-<hash>.png` in the current working directory, where `<hash>` is a short (6-char) stable hash of the rendering inputs (`props` + `theme`). See "Output" below. |
| `--header <"K: V">` | Repeatable. Auth/custom headers for the MCP server connection. Reuses the bearer-token pattern already in `packages/cli/src/commands/client.ts`. |

**Usage:**

```bash
mcp-use screenshot \
  --tool get-objects \
  --args '{"objectType":"deals"}' \
  --width 800 --height 600
# → Saved screenshot: ./deals-list-a3f8c2.png (800×600)
```

The CLI:

1. Connects to the MCP server (`--server URL`, defaults to local dev server) using the existing `MCPClient` from `mcp-use/client` already wired up in `packages/cli/src/commands/client.ts`.
2. Calls `tools/call` with the given args.
3. Extracts view name + structured content from the response.
4. Sets the Playwright browser viewport to `--width × --height`, opens `http://<dev-server>/inspector/preview/<view>?props=<base64>&theme=<theme>` in headless Playwright.
5. Waits for the readiness signal (see below), screenshots the page (full viewport) to `--output`.

### Output

Default output path: `./<view>-<hash>.png` in the current working directory.

- `<view>` is the rendered view name (e.g. `server-list`).
- `<hash>` is a 6-char stable hash of the rendering inputs that affect the pixels: `props` (resolved tool input + structured output) plus `theme`. Width/height are **not** included — re-running at a different viewport produces a different PNG but at the same path, so the agent's most recent screenshot at a given size lives at a predictable location. (If this turns out to matter, revisit.)
- Re-running with the same inputs overwrites the same file. Different inputs → different file. This means the agent's iteration loop naturally accumulates one file per distinct (view, props, theme) combination in cwd, with the latest version always at the same path for any given combination.

The CLI prints exactly one success line on stdout, on its own line, in this format:

```
Saved screenshot: <absolute-path> (<width>×<height>)
```

The absolute path is intentional — agents reading this output can pass it directly to a follow-up `Read` call without resolving it.

Other output behavior:
- Auto-create parent directories if `--output` is supplied with a path whose parents don't exist.
- Overwrite existing files silently. No prompt; this is a non-interactive command.
- Exit non-zero with a clear error message on any failure (Playwright missing, dev server unreachable, MCP call failed, view not found, etc.).
- Stdout PNG bytes (`--output -`) is **not** supported. CLI consumers want a path; image-pipe consumers can `cat` the resulting file.

**Consumption pattern for AI agents.** Reading a screenshot requires two tool calls: `Bash(mcp-use screenshot ...)` to produce the file, then `Read(<path>)` to actually view the image. The CLI cannot directly surface image data to an agent's context — `Bash` tool output is text-only. The success line is formatted to make the follow-up `Read` call obvious. This is documented in the user-facing CLI help.

### Dev server lifecycle

The screenshot CLI needs a running dev server (it serves `/inspector/preview/:view` and proxies the view bundles). Behavior:

1. **Probe first.** Hit `<server>/inspector/health` (the existing readiness endpoint, used by `mcp-use dev` itself — see `packages/cli/src/index.ts`). If 200, reuse it.
2. **Auto-spawn on miss.** If the probe fails (connection refused, timeout, non-200), spawn `mcp-use dev --no-open --no-hmr --port <free-port>` as a child process from the user's project cwd. Pick a free port via standard "bind to 0, read back" rather than a hardcoded fallback.
3. **Wait for readiness.** Poll `/inspector/health` on the spawned port (the existing `waitForServer()` utility already does this — reuse). Time out with a clear error if it doesn't come up within a reasonable window.
4. **Use the spawned URL** for the rest of the run — preview-route navigation and the MCP tool call both target it.
5. **Tear down on exit.** Kill the child on screenshot completion, on errors, and on SIGINT/SIGTERM. The user should never end up with an orphaned dev server they didn't start.

When `--server <url>` is supplied explicitly, skip the spawn entirely — assume the user knows what they're pointing at and fail loudly if it's unreachable.

The spawned dev server's stdout/stderr is piped to the screenshot CLI's stderr with a `[dev]` prefix (or suppressed entirely behind `--quiet`), so it doesn't pollute the deterministic `Saved screenshot:` line on stdout.

Trade-off: the first screenshot in a session pays the Vite cold-start cost (a few seconds). Subsequent screenshots in the same invocation are fast, but the screenshot CLI is single-shot — each invocation re-spawns. If the cold-start cost becomes a real pain point during agent loops, we can revisit by introducing a persistent side-process keyed off a lockfile/PID file in `.mcp-use/`. Out of scope for v1.

### Playwright as optional peer dep

Playwright + browser binaries are heavy. List as an optional peer dep on the CLI package. There is no precedent for optional peer deps in `@mcp-use/cli` today; this is the first.

- If installed: proceed.
- If not: print `Playwright not found. Run \`npx playwright install chromium\` first.` and exit non-zero.
- Optional `mcp-use screenshot --install` shortcut that runs both the npm install and the browser binary download (`npx playwright install chromium`) — installing the package alone doesn't fetch the browser.

## Width/height semantics

`--width` and `--height` set the **Playwright browser viewport**. The preview page renders the view in fullscreen mode filling that viewport (`100vw × 100vh`), and Playwright screenshots the page so the resulting PNG is exactly W×H.

Driving sizing through the viewport (rather than a fixed-size wrapper div) avoids fighting `MCPAppsRenderer`'s `onsizechange` handler — fullscreen mode short-circuits that handler entirely (`MCPAppsRenderer.tsx:657`), so view-initiated `setSize()` calls are ignored and the screenshot dimensions stay deterministic.

Default: `800×600` if either flag is omitted.

## View readiness signal

For the AI feedback loop to be useful, two screenshots of the same view + props must produce the same bytes. Naive readiness checks (iframe `load`, "DOMContentLoaded") fire too early — webfonts may still be loading, lazy-loaded images haven't fetched, CSS transitions are mid-flight, async data hasn't rendered.

The preview page sets `data-view-ready="true"` on `<body>` only after **all** of the following:

1. Iframe `load` event fired.
2. AppBridge handshake completed (host context delivered, view acknowledged).
3. `document.fonts.ready` resolved (in both host page and guest iframe).
4. Two `requestAnimationFrame` ticks elapsed (lets initial layout/paint settle).

Playwright waits for the `body[data-view-ready="true"]` selector before screenshotting.

Escape hatch: `--wait-for <selector>` lets callers override with a custom wait condition for views that gate on async data not surfaced through AppBridge.

## Implementation order

**Smoke tests first** — both are cheap to run, but either failing changes the plan materially. Do them before writing real code.

1. **Smoke test: cross-origin iframe screenshot capture.** The renderer uses a host → proxy → guest iframe chain (`SandboxedIframe.tsx`) where the proxy lives on a different origin. Playwright's full-page screenshot generally captures cross-origin iframe content correctly, but if it doesn't, we have no view pixels to capture and the entire feature is moot. Drive Playwright at an existing inspector view (e.g. open `kanban-board` in the running inspector at its current route, screenshot, eyeball the PNG). If the iframe content shows up: proceed. If it doesn't: stop and reassess (may need to render the view at the host level instead of inside the sandboxed iframe, which would be a much bigger change).
2. **Smoke test: SPA fallback for `/inspector/preview/*`.** Confirm `mountInspectorUI` already serves the inspector's `index.html` for arbitrary sub-paths under `/inspector/*`. Hit `/inspector/preview/anything` against a running dev server; expect the inspector SPA shell. If not: add the catch-all route (one-liner) before step 3.
3. Add the `/preview/:view` route inside the inspector SPA, with a minimal `<ViewPreview>` component that mounts `<MCPAppsRenderer>` in fullscreen and reads params from the URL.
4. Implement the readiness signal (`data-view-ready` on `<body>`).
5. Implement the CLI command (`screenshot --tool`) in `@mcp-use/cli`, including the auto-spawn dev-server logic described above.
6. Wire `--header` auth pass-through using the existing client.ts pattern.
7. Validate end-to-end against an existing template (e.g. `kanban-board` or `chart-builder`).

## Testing

- Unit tests for the CLI: arg parsing, base64 props encoding, error paths (Playwright missing, invalid view name, MCP call failure, dev server unreachable).
- Integration test: spin up an example MCP server with a view, run `mcp-use screenshot` against it, assert PNG dimensions match `--width`/`--height` and the file is non-empty.
- Determinism test: run the same screenshot twice with the same inputs, assert the bytes match. Catches regressions in the readiness signal.
- Manual visual check against at least one MCP Apps view to confirm rendering parity with the inspector at the same viewport size.
