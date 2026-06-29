# Phase 3: MCP SDK v2 Migration Research

**Date:** 2026-06-27  
**Branch:** mcp-use V2  
**Status:** Implemented on V2 branch (2026-06-27) — `@modelcontextprotocol/server@2.0.0-alpha.3` + `@modelcontextprotocol/client@2.0.0-alpha.3`

> Historical note: sections that say "stay on sdk@1 for now" capture the original spike decision before the V2 branch moved to split SDK v2 packages. For current SDK-first direction, use `sdk-first-mcp-use-plan.md` as the source of truth: V2 is SDK-v2-only and direct SDK imports should go through the allowed `@modelcontextprotocol/*` surface.

## 1. npm package availability

| Package | Latest version | Notes |
|---------|----------------|-------|
| `@modelcontextprotocol/sdk` | **1.29.0** | Monolithic v1 (mcp-use pins **1.26.0**) |
| `@modelcontextprotocol/server` | **2.0.0-alpha.3** | Server-only; alpha, breaking changes expected |
| `@modelcontextprotocol/client` | **2.0.0-alpha.3** | Client-only; alpha |
| `@modelcontextprotocol/node` | **2.0.0-alpha.3** | Node HTTP adapter (`NodeStreamableHTTPServerTransport`) |
| `@modelcontextprotocol/hono` | **2.0.0-alpha.3** | Hono integration (not evaluated in depth) |
| `@modelcontextprotocol/express` | **2.0.0-alpha.3** | Express integration |

Official README on all v2 packages:

> **This is an alpha release.** Expect breaking changes until v2 stabilizes.

Migration guide referenced: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md (404 at time of research — doc may not be published yet).

## 2. Import inventory (`@modelcontextprotocol/sdk`)

**Scope:** `libraries/typescript` — **121 files** reference the SDK.

### mcp-use package (~95 import sites across ~60 files)

#### Server-side (`@modelcontextprotocol/server` in v2)

| v1 subpath | Files (approx) | mcp-use usage |
|------------|----------------|---------------|
| `server/mcp.js` | 8 | `McpServer`, `ResourceTemplate`, registration types |
| `server/webStandardStreamableHttp.js` | 1 | `mount-mcp.ts` dynamic import |
| `server/completable.js` | 2 | URI/prompt completion |
| `server/zod-compat.js` | 1 | `SchemaInput` type |
| `server/zod-json-schema-compat.js` | 2 | `toJsonSchemaCompat` (elicitation, tool schemas) |
| `server/index.js` + `server/stdio.js` | 2 | Test stdio servers |
| `types.js` (shared) | ~25 | Protocol types, `CallToolResult`, capabilities, etc. |

#### Client-side (`@modelcontextprotocol/client` in v2)

| v1 subpath | Files (approx) | mcp-use usage |
|------------|----------------|---------------|
| `client/index.js` | 12 | `Client`, notification types |
| `client/streamableHttp.js` | 11 | `StreamableHTTPClientTransport` |
| `client/stdio.js` | 3 | `StdioClientTransport`, params |
| `client/sse.js` | 1 | `SSEClientTransport` (legacy) |
| `client/auth.js` | 14 | OAuth: `auth`, `OAuthClientProvider`, `extractWWWAuthenticateParams` |

#### Shared (split across server/client in v2)

| v1 subpath | Files | Notes |
|------------|-------|-------|
| `shared/auth.js` | 8 | OAuth token/metadata types |
| `shared/transport.js` | 3 | `Transport`, `TransportSendOptions` |
| `shared/protocol.js` | 3 | `RequestOptions` |

### Other packages

- **@mcp-use/inspector:** ~40 files, mostly `types.js` re-exports for UI
- **@mcp-use/client:** V2 split-package shim over `mcp-use/client`
- **Root `package.json`:** no pnpm patch; V2 depends directly on `@modelcontextprotocol/client` and `@modelcontextprotocol/server`

## 3. v2 API differences (spike findings)

### Package split

v1 monolith → v2 packages:

```
@modelcontextprotocol/sdk          →  @modelcontextprotocol/server  (server + types)
                                    →  @modelcontextprotocol/client  (client + types)
                                    →  @modelcontextprotocol/node    (Node HTTP shim)
```

Subpath imports collapse to package root exports (no more `/server/mcp.js`, `/client/auth.js`, etc.).

### Import mapping (representative)

| v1 | v2 |
|----|-----|
| `@modelcontextprotocol/sdk/server/mcp.js` | `@modelcontextprotocol/server` |
| `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` | `@modelcontextprotocol/server` |
| `@modelcontextprotocol/sdk/client/index.js` | `@modelcontextprotocol/client` |
| `@modelcontextprotocol/sdk/client/streamableHttp.js` | `@modelcontextprotocol/client` |
| `@modelcontextprotocol/sdk/client/auth.js` | `@modelcontextprotocol/client` |
| `@modelcontextprotocol/sdk/types.js` | `@modelcontextprotocol/server` or `@modelcontextprotocol/client` (types duplicated at package roots) |
| `@modelcontextprotocol/sdk/shared/auth.js` | `@modelcontextprotocol/client` |
| `@modelcontextprotocol/sdk/shared/transport.js` | same package as consumer (server or client) |

### Renamed / removed APIs

| v1 | v2 | Impact on mcp-use |
|----|-----|-------------------|
| `McpError` + `ErrorCode` | `ProtocolError` + `ProtocolErrorCode` (or `INVALID_PARAMS`, etc.) | `mcp-server.ts` (4 throw sites) |
| `toJsonSchemaCompat()` | **Removed** — use Standard Schema / `fromJsonSchema()` | `tool-execution-helpers.ts`, elicitation tests |
| `SchemaInput` from `zod-compat` | `StandardSchemaWithJSON` / `StandardSchemaV1` | `completion-helpers.ts` |
| Zod 4 via patched `zod-compat.js` | Native Zod 4 + Standard JSON Schema (`~standard.jsonSchema`) | **Can drop pnpm patch** once on v2 |
| OAuth via `OAuthClientProvider` only | New unified `AuthProvider` + `adaptOAuthProvider()` | Transports accept both; refactor optional |
| `SSEClientTransport` | Deprecated in v2 client | Removed from V2; guardrails prevent reintroducing SSE client fallback |

### Unchanged (spike: `mount-mcp.ts`)

These remain compatible for our distributed SSE routing hack:

- `WebStandardStreamableHTTPServerTransport` — same class name, same options (`sessionIdGenerator`, `onsessioninitialized`, `enableJsonResponse`)
- `handleRequest(req: Request)` — unchanged
- Internal fields still present in alpha.3: `_streamMapping`, `_standaloneSseStreamId`, `_initialized`, `sessionId`
- `McpServer.connect(transport)` — unchanged

See the current implementation in `packages/mcp-use/src/server/endpoints/mount-mcp.ts`.

## 4. Historical blockers resolved for V2

This section originally explained why the repo could not move to SDK v2. The V2 branch now treats those items as completed migration context:

1. **Alpha stability** — accepted for the V2 alpha branch; imports are pinned to split SDK v2 packages.
2. **pnpm patch replacement** — resolved by removing the unused `@modelcontextprotocol/sdk` patch.
3. **`toJsonSchemaCompat` removal** — migrated away from SDK v1 helper imports.
4. **Error type migration** — migrated to SDK v2 protocol errors where the server bridge needs them.
5. **Dual-package types** — handled by explicit server/client import surfaces.
6. **Inspector + examples + tests** — updated as part of the V2 branch migration.
7. **`@mcp-ui/server` SDK v1 dependency** — resolved by removing `@mcp-ui/server` and banning it from core packages.
8. **Migration guide 404** — still a docs caveat; rely on current package APIs and local conformance checks.

## 5. Migration checklist (when v2 reaches stable)

### Prerequisites

- [x] `@modelcontextprotocol/server` and `@modelcontextprotocol/client` adopted for V2 alpha
- [ ] Official migration guide published and reviewed
- [x] Remove `@mcp-ui/server` dependency instead of waiting for v2 peer deps
- [x] Remove `patches/@modelcontextprotocol__sdk.patch` after Zod 4 verified on v2

### Phase A — dependencies

- [ ] Replace `@modelcontextprotocol/sdk` with `@modelcontextprotocol/server` + `@modelcontextprotocol/client` in `mcp-use/package.json`
- [ ] Add `@modelcontextprotocol/node` only if Express/Node raw HTTP paths needed (Hono uses Web Standard transport directly)
- [ ] Update `@mcp-use/client` peer dep range
- [ ] Update inspector, examples, proxy example `package.json`

### Phase B — mechanical import rewrite

- [ ] Codemod: `@modelcontextprotocol/sdk/server/*` → `@modelcontextprotocol/server`
- [ ] Codemod: `@modelcontextprotocol/sdk/client/*` → `@modelcontextprotocol/client`
- [ ] Codemod: `@modelcontextprotocol/sdk/types.js` → `@modelcontextprotocol/server` (server files) or `client` (client files)
- [ ] Codemod: `@modelcontextprotocol/sdk/shared/*` → appropriate v2 package
- [ ] Update `tsup.config.ts` externals list

### Phase C — API migrations

- [ ] `McpError`/`ErrorCode` → `ProtocolError`/`ProtocolErrorCode` in `mcp-server.ts`
- [ ] `toJsonSchemaCompat` → Standard Schema JSON export or `fromJsonSchema()` in tool-execution + elicitation
- [ ] Review OAuth providers against new `AuthProvider` interface (optional cleanup)
- [ ] Audit SSE transport deprecation path

### Phase D — validation

- [ ] Unit tests (`pnpm --filter mcp-use test:unit`)
- [ ] Integration tests (streamable HTTP, elicitation, OAuth, completion, session isolation)
- [ ] Deno compatibility test suite
- [ ] Inspector smoke test
- [ ] Remove sdk@1 from lockfile; guardrails verify `@mcp-ui/server` and `@mcp-ui/client` do not return

## 6. `@mcp-ui/server` removal assessment

### Current usage

`@mcp-ui/server` has been removed from V2. Internal app/view code now lives under `src/server/views/`, and the `src/server/widgets/` implementation tree is a forbidden removed path.

### What `createUIResource` does (~50 LOC)

For `externalUrl`: builds `{ type: 'resource', resource: { uri, mimeType: 'text/html', text: iframeUrl } }`  
For `rawHtml`: optionally runs `wrapHtmlWithAdapters()` then same shape with `text/html` or adapter mime type (`text/html+skybridge`).

Encoding `blob` base64-encodes content.

### Already inlined in mcp-use

These resource types **do not** use `@mcp-ui/server`:

- `appsSdk` → manual `text/html+skybridge` (same as OpenAI docs)
- `mcpApps` → manual `text/html;profile=mcp-app` with `_meta.ui`
- `remoteDom` → manual mime (v6 removed from createUIResource)

### Removal decision

| Scenario | Feasibility |
|----------|-------------|
| `externalUrl` / `rawHtml` / `remoteDom` legacy resources | **Removed** — zero in-repo usage on the V2 branch |
| `appsSdk` | **Kept** — manual `text/html+skybridge` builder |
| `mcpApps` | **Kept** — manual `text/html;profile=mcp-app` builder |
| Full `@mcp-ui/server` removal | **Done** — enforced by dependency and import guardrails |

### Recommendation

- Keep the public view/widget migration aliases already exposed from `src/server/views/index.ts`.
- Keep wire compatibility names (`/mcp-use/widgets`, `ui://widget/...`, `widget.tsx`) because hosts and built resources still use them.
- Do not recreate `src/server/widgets/`; `scripts/check-v2-guardrails.mjs` fails if that path returns.
