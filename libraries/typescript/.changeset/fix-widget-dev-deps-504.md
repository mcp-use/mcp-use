---
"mcp-use": patch
---

fix(widgets): pre-warm widget Vite entries before registration to prevent first-render `/.vite/deps/*` 504s

When a widget is registered (initial boot, watcher add-file, or watcher add-folder), `mount-widgets-dev` now calls `viteServer.warmupRequest()` followed by `viteServer.waitForRequestsIdle()` for the widget's `entry.tsx` before exposing it to the inspector. This forces Vite's `depsOptimizer` to finish pre-bundling and stabilise its dependency hash before the browser starts requesting `/.vite/deps/*` modules.

Previously, the inspector iframe could fetch optimized dependencies (e.g. `mcp-use_react.js`) with a stale Vite hash while `depsOptimizer` was still re-bundling, which surfaced as `504 Gateway Timeout` errors and a blank widget on first interaction in Vibe-created sandboxes. Each widget is warmed at most once per dev-server lifetime; failures fall back to a warning so registration never blocks.
