---
"@mcp-use/inspector": patch
---

fix(inspector): detect Hono via duck-typing, not `instanceof`

`mountInspector(app)` chose between a fast Hono-direct path and a slower Express-compat bridge based on `app instanceof Hono`. That check is unreliable across a published library boundary. When this package and the host (e.g. `mcp-use`) resolve different `Hono` constructors (common in monorepos where workspace deps hoist their own `hono`, when Node loads Hono's dual CJS+ESM builds from the same on-disk copy as two separate module records, or under bundler dedup), `instanceof` returns false even for a real Hono app. The Express bridge then runs against a Hono `Context` and crashes on every request trying to read `req.headers.host`:

```
TypeError: Cannot read properties of undefined (reading 'host')
    at .../@mcp-use/inspector/dist/server/chunk-*.js (mountInspector Express bridge)
```

Switch to a duck-type check: Hono apps expose `.fetch(Request) => Response`; Express apps don't. The check is unambiguous for the documented input set and works regardless of which physical Hono module produced the app. Surfaces immediately in the new Next.js drop-in flow (`--mcp-dir`) because Next.js apps almost always pull in a second `hono` through other deps, but the underlying problem applies any time the host and inspector resolve Hono through different module records.
