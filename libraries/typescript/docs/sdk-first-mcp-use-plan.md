# SDK-First mcp-use Plan

This is the agent-readable planning artifact for the TypeScript V2 SDK-first direction. It distills `/Users/et/.cursor/plans/sdk-first_mcp-use_9503000a.plan.md` into the decisions that should guide docs, JSDoc, future implementation work, and branch reviews.

## Product Position

mcp-use V2 should be an SDK-first framework, not a protocol fork.

The official MCP SDK owns protocol behavior: protocol types, JSON-RPC handling, tools, resources, prompts, stdio, Streamable HTTP, auth primitives, and optional framework/runtime adapters. mcp-use owns the product layer that developers and agents otherwise rebuild around the SDK: defaults, app/view registration, OAuth provider recipes, local dev, host compatibility, validation, deployment, diagnostics, and agent-readable guardrails.

The core V2 posture is **lean, no-fallback, stateless-first, SDK-v2-only**:

- **Lean:** delete duplicated abstractions, workaround stacks, stale compatibility paths, and dependencies that do not buy real user value.
- **No fallback-first modeling:** fallback paths are temporary migration shims, explicit platform capability differences, or deliberate degraded-mode product decisions. They should not become the normal architecture.
- **Stateless-first:** no mcp-use product feature should require `Mcp-Session-Id`, remembered initialize capabilities, or fake sessions keyed by auth/user-agent. Stateful SDK sessions may remain for compatibility, but product semantics should be expressible from request-scoped data, auth principal, explicit handles, or persisted resources.
- **SDK v2-only:** the first mcp-use V2 release should treat the split `@modelcontextprotocol/*` v2 packages as the only MCP SDK import surface.
- **Config/workspace split:** committed intent lives in `mcp-use.json`; generated build output, local state, caches, sessions, screenshots, eval runs, and cloud link metadata live under ignored `.mcp-use/`.

## Current V2 Baseline

Use the current V2 branch as evidence, not as a constraint. Keep what is already the simplest correct path, refactor what becomes simpler under the SDK-first design, and delete branch-only compatibility that has not shipped as stable V2.

| Area | Current branch evidence | SDK-first direction |
|------|-------------------------|---------------------|
| Server runtime | Hono app, `listen()`, `getHandler()`, Streamable HTTP through SDK v2 transport | Keep Hono as the app/runtime shell; compose official SDK route adapters where they reduce private transport code |
| MCP SDK | Split `@modelcontextprotocol/server` / `@modelcontextprotocol/client` imports are in branch work | Keep SDK v2 packages as the only SDK surface and document any direct SDK access through a narrow bridge |
| Views/apps | `views/` is canonical; widget names remain as wire/migration aliases; inline JSX and `ToolRef` exist | MCP Apps metadata is the baseline; OpenAI/ChatGPT metadata is an overlay; inline JSX returns are first-class |
| CLI | `@mcp-use/cli` already contains dev/build/start/client/screenshot/deploy surfaces | Move primary `mcp-use dev/build/start` ownership into the main package; keep the CLI implementation slim and lazy-loaded |
| Inspector | Browser debugger/client exists with OAuth, widgets/views, RPC logs, screenshots, and preview routes | Keep inspector UI externalized/CDN-backed; extract shared headless primitives only when doctor/evals need them |
| Middleware | `server.use("mcp:*")` wraps list/call/read/get operations | Use this point for authorization, metadata shaping, dynamic exposure, schema checks, and diagnostics |
| Type story | Generated registry and new zero-codegen `ToolRef` path both exist | Make zero-codegen `ToolRef` and inline JSX inference primary; keep explicit typegen as secondary |
| Sessions | Stateful session store and stream routing still exist; stateless request handling exists | Make stateless behavior the product foundation; isolate stateful session support as compatibility/runtime behavior |

## Ownership Boundary

### SDK-Owned

The official MCP SDK owns:

- Protocol types and JSON-RPC request/response semantics.
- Tool/resource/prompt registration primitives.
- Streamable HTTP, stdio, and in-memory testing transports.
- SDK auth primitives, protected-resource metadata, bearer challenges, and framework adapters where provided.
- Future MCP Apps helpers such as AppBridge and metadata constants when they are stable and fit mcp-use.

### mcp-use-Owned

mcp-use owns:

- The Hono application shell around MCP routes.
- Server authoring ergonomics such as `MCPServer`, `server.tool`, `server.resource`, `server.prompt`, `text`, `object`, `view`, and inline JSX returns.
- OAuth provider recipes and proxy mode.
- Views/apps build, HMR, asset serving, CSP validation, and host overlays.
- CLI dev/build/start, doctor, inspect, typegen, evals, deploy, screenshots, and submission checks.
- Agent-readable diagnostics, JSON manifests, guardrails, and high-signal JSDoc.
- Optional public instrumentation adapters and internal dependency-free product telemetry.

### Boundary Rules

- Use a narrow internal `SdkBridge` boundary, or equivalent, for version-sensitive direct SDK code.
- Do not access SDK-private fields outside the boundary. Any unavoidable private-field access must be named, tested, and have a removal condition.
- Preserve public `schema: z.object(...)` ergonomics; convert to SDK `inputSchema` internally.
- Prefer official SDK adapters for raw route/transport behavior when they cover the need. mcp-use should keep only the product shell around them.
- Expose native SDK access only through intentionally named advanced APIs such as `nativeServer`.

### Allowed SDK V2 Import Surface

`packages/mcp-use/src/server/sdk-bridge.ts` is the value-import boundary for official server runtime primitives used by `MCPServer` and the `/mcp` mount. New transport or server construction code should import from that bridge, not directly from `@modelcontextprotocol/server`.

| SDK package | Allowed use in mcp-use V2 |
|-------------|---------------------------|
| `@modelcontextprotocol/server` | Server/runtime value imports only through `src/server/sdk-bridge.ts`: `McpServer`, `ResourceTemplate`, `WebStandardStreamableHTTPServerTransport`, `ProtocolError`, and `ProtocolErrorCode`. Type-only imports may remain near protocol-specific callbacks while migration is in progress. |
| `@modelcontextprotocol/client` | Client package code, CLI client surfaces, inspector client code, and local eval runners. Server runtime modules should not import client values. |
| `@modelcontextprotocol/ext-apps` | App metadata/AppBridge helpers when they remove local duplication and do not make ChatGPT/OpenAI fields the source of truth. |
| `@modelcontextprotocol/hono` / `@modelcontextprotocol/node` | Candidate route adapters for `/mcp` spikes only; do not replace the Hono product shell unless conformance tests show less custom code with equivalent behavior. |
| `@modelcontextprotocol/express` | Reference or migration-only. Do not add Express to core. |

## Adapter Inventory

| Adapter type | Examples | Owner | Direction |
|--------------|----------|-------|-----------|
| Protocol | SDK bridge, Streamable HTTP, stdio, in-memory tests | SDK-owned with mcp-use bridge | Compose SDK behavior; do not fork protocol semantics |
| Runtime | Hono, Node listener, edge/serverless fetch handler | mcp-use-owned shell | Keep Hono for app routes; evaluate official Hono/web adapters for `/mcp` only |
| Host | MCP Apps, OpenAI/ChatGPT overlay, local emulator/preview | mcp-use-owned product layer | MCP Apps first; ChatGPT/OpenAI fields only as overlay |
| Agent framework | LangChain, future Vercel AI SDK, server code mode | Optional package/adapter | Keep out of core server architecture unless it is a tiny bridge |
| Migration | Widget aliases, transitional CLI wrapper, legacy output paths | Migration-only | Keep only with an explicit removal or alias plan |

## Official Adapter Comparison

| Official package | Likely role in mcp-use V2 | Open question |
|------------------|---------------------------|---------------|
| `@modelcontextprotocol/server` | Server primitives, protocol types, Streamable HTTP transport, auth/server helpers | Which current private-field patches can be removed or isolated behind a bridge? |
| `@modelcontextprotocol/client` | Client primitives for `MCPClient`, CLI client, inspector, local eval runner | How to share client behavior without duplicating inspector/CLI/client code paths? |
| `@modelcontextprotocol/node` | Optional Node HTTP adapter for pure Node/server use cases | Does it reduce mcp-use code when Hono already owns the app shell? |
| `@modelcontextprotocol/hono` | Candidate for the `/mcp` route adapter only | Does it cover stateless/stateful tests, `HEAD`/`DELETE`, notifications, and error shape without custom routing? |
| `@modelcontextprotocol/express` | Migration/reference only | Do not pull Express into core. |
| `@modelcontextprotocol/ext-apps` | App metadata/AppBridge helper source when stable | Use standard MCP Apps metadata as baseline; avoid making ChatGPT-specific fields the source of truth. |

## Apps And Skybridge Lessons

MCP Apps standard fields are the baseline: `ui://` resources, `_meta.ui.resourceUri`, `text/html;profile=mcp-app`, sandboxed iframes, AppBridge, and bidirectional `ui/*` messages. OpenAI Apps SDK fields such as `openai/outputTemplate`, `openai/widgetDescription`, `openai/widgetAccessible`, invocation labels, and `window.openai` are compatibility overlays when a host needs them.

Common failure taxonomy to catch before host testing:

- Missing or mismatched resource URI between `tools/list`, tool result metadata, and `resources/read`.
- Wrong MIME type or self-referential `outputTemplate`.
- `structuredContent` not reaching widget state, usually because render-tool and data-tool semantics are blurred.
- Missing output schema for app-visible structured data.
- CSP domains that work locally but fail in a sandboxed iframe or published host.
- Stale hashed assets, localhost asset URLs, or missing inline-only route setup.
- Host bridge methods used without capability checks.

The first-class authoring model is direct inline JSX returns from tool handlers. Explicit `widget` configuration and `view()` helpers remain migration/advanced paths, not parallel fallback architecture.

## Project Config And Workspace

V2 should separate committed desired state from ignored framework state.

```text
mcp-use.json                 # committed config, no secrets
evals/                       # committed eval specs and optional reviewed baselines
.mcp-use/                    # ignored framework workspace
  build/                     # compiled server, built views, immutable manifest
  generated/                 # optional generated registry/view types
  cache/                     # metadata, view, and Vite caches
  state/                     # local sessions and tunnel state
  cloud/                     # local cloud link IDs and deployment pointers
  eval/runs/                 # local eval run reports/artifacts
  screenshots/
  logs/
```

Initial policy:

- `mcp-use.json` commits reviewable intent: name, entry, dirs, build/start settings, cloud slugs/names, region, branch/watch paths, required secret names, and eval defaults.
- Do not commit secrets or one-off deployment IDs.
- `.mcp-use/cloud/link.json` stores checkout-local resolved IDs and deployment pointers.
- CLI/CI precedence is `flags > env vars > .mcp-use/cloud/link.json > mcp-use.json > cloud defaults`.
- Default build output moves from `dist/` to `.mcp-use/build/`; `dist/` remains only as an explicit override or migration path.
- Generated types default to `.mcp-use/generated/` and are produced by explicit commands such as `mcp-use typegen` or `mcp-use check`, not by template `postinstall`.

## Gap Table

| Status | Items |
|--------|-------|
| Already implemented or partially implemented | SDK v2 package split, Streamable HTTP only, Hono runtime, views rename, inline JSX pipeline, `ToolRef` overload, externalized inspector UI, CLI dev/build/start/client/screenshot surfaces, MCP operation middleware, OAuth providers, type generation, many examples/tests |
| Needs cleanup or consolidation | SDK-private field access in server/session/HMR paths, stateful session defaults vs stateless-first target, widget terminology in internal filenames and wire aliases, migration guide CLI packaging mismatch, generated type output conventions, duplicate inspector/CLI/client primitives, legacy `dist/mcp-use.json` build manifest assumptions |
| New product layer | `SdkBridge` boundary and conformance tests, adapter inventory tests, `mcp-use.json` schema/loader, `.mcp-use/` workspace migration, `doctor --json`, `inspect --json`, apps validator, OAuth compatibility harness, policy/authz middleware, eval YAML runner, instrumentation adapters, host repro bundles, submission checks, agent skills/prompts |

## Documentation And JSDoc Checklist

High-signal docs/JSDoc should explain intent and boundaries, not restate code mechanics.

- Public APIs: `MCPServer`, `server.tool`, `server.resource`, `server.prompt`, `ToolRef`, `useCallTool`, `view`, `useView`, response helpers, auth helpers, instrumentation, evals.
- Internal boundaries: SDK bridge, `/mcp` mount, auth middleware, view build pipeline, config loader, instrumentation manager.
- Invariants: SDK v2-only imports, stateless-first product semantics, no fallback-first modeling, no SDK-private access outside the bridge, no secrets in committed config.
- Extension points: official SDK adapters, runtime adapters, host overlays, policy functions, sandbox backends, instrumentation adapters.

## Current Inconsistencies To Resolve

These were found while creating this docs artifact:

- `docs/typescript/v2-migration.mdx` describes `@mcp-use/cli` as an explicit dev dependency, while the SDK-first plan says the primary CLI should move into the main `mcp-use` package. Treat the external CLI wording as interim-alpha guidance unless the packaging decision changes.
- `libraries/typescript/docs/phase3-mcp-sdk-v2-migration.md` says to stay on SDK v1 and lists v2 blockers, but its status and the current branch indicate SDK v2 split packages have already landed. Mark the old blocker list as historical when updating that file.
- The plan says stateless-first, while `mount-mcp.ts` still supports and defaults some Node/SSE-capable flows into stateful sessions. That can be a compatibility/runtime path, but docs and future code should not add product features that depend on remembered session state.
- Views are canonical in public docs, but internal filenames and wire aliases still use widget terminology. That is acceptable as migration evidence, not a reason to build new widget-named APIs.
- The plan moves default build output to `.mcp-use/build/`, while some current production view code still references `dist/mcp-use.json`. Treat `dist/` as legacy or explicit override in future docs and implementation.

## Non-Goals

- Do not fork MCP protocol behavior.
- Do not preserve branch-only compatibility forever.
- Do not make React required for tool-only servers.
- Do not use ChatGPT-only `window.openai` as the app baseline.
- Do not hide broad dynamic behavior behind framework-level fallback abstractions.
- Do not add dependencies unless they remove more code, provide a real platform primitive, or stay behind an optional adapter/subpath.
