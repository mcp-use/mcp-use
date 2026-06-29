# Phase 4: Legacy Cleanup & Architecture Consolidation

**Branch:** V2  
**Status:** Mostly complete — optional extraction wave remains  
**Supervision model:** Multi-agent exploration → supervised wave execution

## Exploration reports (completed)

| Agent | Scope | Key finding |
|-------|-------|-------------|
| [Session/SSE](5b44e750-5a05-4629-84de-18ec5f8208a6) | ~4.4k LOC transport/session | Legacy: `/sse` alias, `SSEClientTransport` fallback, dead `StreamableHttpConnectionManager`. Keep stateful session/stream stack. |
| [Widgets/@mcp-ui](a8853147-3b5f-45a1-8b84-58e9574091c6) | 16 widget + 11 react files | Zero in-repo usage of `externalUrl`/`rawHtml`/`remoteDom`. Safe to drop `@mcp-ui/server`. |
| [Folder consolidation](f33e6150-4fe5-48cc-8df8-53b13da58bbc) | 100 server files | Delete 6 thin barrels; merge HTTP utils; extract 3 modules from 4.3k-line `mcp-server.ts`. |
| [Deprecated APIs](c5b5890b-851c-4591-9e24-7dff1fcc9aec) | All packages | Hard-delete batch: `createMCPServer`, `autoCreateSessionOnInvalidId`, `clientConfig`, CLI `profile*`, `widget().data`. |

## Execution waves

### Wave 1 — Dependency & dead code ✅
**Goal:** Remove `@mcp-ui/server`, delete no-op/dead APIs, thin barrels.

- [x] Remove `@mcp-ui/server` dep; inline or delete legacy UI types (`externalUrl`, `rawHtml`, `remoteDom`)
- [x] Delete `createMCPServer()`, `autoCreateSessionOnInvalidId`
- [x] Delete thin barrels: `server/types.ts`, `endpoints/index.ts`, `roots/index.ts`, `notifications/index.ts`, `inspector/index.ts`, `tools/index.ts`
- [x] Remove `WidgetResponseConfig.data` alias; update tests
- [x] Rename `widgets/widget-types.ts` `ServerConfig` → `WidgetMountConfig` (collision fix)
- [x] Update `deno.json` to drop `@mcp-ui/server`

### Wave 2 — View rename + folder move ✅
**Goal:** `views/` internally; `view`/`useView`/`mountViews` public; widget names deprecated aliases.

- [x] Rename directory `widgets/` → `views/` (internal)
- [x] `widgets/index.ts` re-export shim for deep imports
- [x] Public API: `mountViews`, `useView`, `view()`, `ViewResponseConfig`, `UseViewResult`
- [x] Deprecated aliases: `mountWidgets`, `useWidget`, `widget()`, `WidgetResponseConfig`, `UseWidgetResult`
- [x] Keep wire aliases: `/mcp-use/widgets/`, `ui://widget/`, `widget.tsx`, `widgetMetadata`
- [ ] Rename internal files (`mount-widgets-dev.ts` → `mount-views-dev.ts`, etc.) — deferred (low value)

### Wave 3 — Transport legacy gate ✅
**Goal:** Streamable HTTP first; legacy SSE removed in Wave 5.

- [x] Default `disableSseFallback: true` (HttpConnector + useMcp) — superseded by full SSE removal
- [x] Delete unused `StreamableHttpConnectionManager`
- [x] Extract `mount-mcp.ts` stream routing to `transport/stream-routing.ts`
- [x] Remove `SseConnectionManager` + `/sse` routes (Wave 5)

### Wave 4 — Registration API cleanup ✅
- [x] Two-arg only: `tool`/`prompt`/`resource`/`resourceTemplate(def, callback)`
- [x] Removed `cb`, `readCallback`, `inputs`, `args`, nested `resourceTemplate`

### Wave 5 — Deprecated alias hard delete ✅
- [x] `customHeaders` → `headers` only (mcp-use API; inspector reads legacy stored keys)
- [x] `samplingCallback`/`elicitationCallback` → `onSampling`/`onElicitation` only
- [x] `clientConfig` (useMcp) removed — OAuth derived from `clientInfo`
- [x] `MCPServer.server` getter removed — use `nativeServer`

### Wave 5 — ESM-only + SSE removal ✅
- [x] ESM-only builds for mcp-use, `@mcp-use/client`, `@mcp-use/agent`
- [x] Delete legacy MCP SSE (`SseConnectionManager`, `/sse` routes, `transportType: "sse"`)

### Wave 6 — Inline JSX + ToolRef ✅
- [x] Port from PR #1347: jsx-runtime, ToolRef, streamable, inline widget pipeline
- [x] CLI `ensureUserTsconfigJsx` (`packages/cli/src/utils/ensure-user-tsconfig-jsx.ts`)

### Wave 7 — Guardrails ✅
- [x] Update v2 migration guide with Phase 4 breaking changes
- [x] knip/CI rules for removed paths (`scripts/check-v2-guardrails.mjs`, ESLint import bans)
- [ ] Run full integration test smoke

### Wave 8 — mcp-server.ts extraction (optional, deferred)
**Goal:** Maintainability without new abstractions.

- [ ] Extract `core/widget-sessions.ts`, `core/registration-sync.ts`, `core/session-replay.ts`
- [ ] Merge `server-helpers` + `server-lifecycle` + `hono-proxy` + `runtime` → `http/hono.ts`
- [ ] Merge `types/widget.ts` into `types/resource.ts`
- [ ] OAuth: `cors-proxy-routes.ts` rename; optional JWKS provider base

## Target folder structure (end state)

```
server/
├── index.ts              # Public exports (stable)
├── mcp-server.ts         # Core class (~2k lines after extract)
├── core/                 # Session replay, HMR sync, widget sessions
├── transport/            # mount-mcp, stream-routing
├── sessions/             # Unchanged (stores + streams)
├── views/                # Was widgets/
├── oauth/                # Flattened naming
├── http/                 # Hono helpers merged
├── types/                # Single barrel, no widget.ts shim
├── tools/                # registration + execution
├── openapi/              # Unchanged
└── inspector/            # mount.ts only
```

## Non-goals (Phase 4)

- Full `@mcp-use/server` npm rename (Phase 2 milestone 2)
- Hard delete of widget → view deprecated aliases (user policy: keep until next wave)
- Cloud gateway session changes — coordinate separately
