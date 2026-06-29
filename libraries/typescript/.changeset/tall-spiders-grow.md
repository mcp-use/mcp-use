---
"mcp-use": patch
---

Harden the static widget/public file routes against path traversal. `setupPublicRoutes`, the `/mcp-use/widgets/:widget` and `/mcp-use/widgets/.../assets/*` routes, and the favicon route now reject any request whose raw or decoded path contains a `..` segment, an absolute path, or a NUL byte (and, for single-segment widget names, a path separator) before any filesystem access. `pathHelpers.join` now also lexically collapses `.`/`..` segments as defense-in-depth.

In practice the mainstream runtime adapters (Node via `@hono/node-server`, Deno, Bun, Workers) already normalize `..` out of the request path before routing, so this was not exploitable on a standard deployment. The new guards are the real containment control for embeddings that don't normalize the path (e.g. mounting the Hono app under Express) and protect against future adapter changes.
