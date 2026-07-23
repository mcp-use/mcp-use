# Temporary v1 drop-in compatibility plan and status

> Status: implemented in the current working tree and verified against the
> locally packed package. Remaining release work is called out explicitly.
>
> The detailed API audit remains in `v2-MIGRATION.md`.

## Goal

Ordinary stateless v1 servers should work after upgrading the dependency, without
rewriting their server code:

```diff
  "dependencies": {
-   "mcp-use": "^1.34.3"
+   "mcp-use": "^2.0.0"
  }
```

“Most” is intentionally not a numeric target. It means the normal server:

- imports from `mcp-use/server`;
- creates an `MCPServer`;
- registers Zod-based tools, resources, resource templates, and prompts;
- returns common response helpers or raw MCP results;
- optionally uses a v1 widget/view without changing its directory, metadata,
  provider, or hooks;
- optionally uses ordinary middleware, CORS, Host validation, landing-page
  metadata, or a built-in external OAuth provider;
- calls `await server.listen()` from a directly executed entry file.

The compatibility work should stay small. It should translate these common
v1 shapes onto the stateless v2 server, not recreate the v1 architecture.
It is a temporary migration bridge for existing v1 applications, not a second
supported way to build new servers.

## Non-goals

Do not complicate v2 to support:

- session stores, stream managers, active-session APIs, or session metadata;
- sampling, roots callbacks, or arbitrary per-session notifications;
- old blocking elicitation behavior;
- built-in OAuth proxy/authorization-server mode;
- raw third-party `@mcp-ui/server` UI resources that do not use the mcp-use
  widget/view contract;
- stdio child-process proxies;
- direct access to native server or transport internals;
- old `inputs`/`args` array schemas instead of Zod schemas;
- CommonJS or Node.js 20;
- custom OAuth providers with arbitrary token-verification code in the first
  compatibility release;
- new server development or new v2 features through `mcp-use/server`.

These cases already have real architectural differences. They should receive a
clear migration error or documentation, not another compatibility subsystem.

## Approach

Add a compatibility export at `mcp-use/server`. Keep `mcp-use` itself as the
clean v2 API.

```text
unchanged v1 server
        ↓
mcp-use/server compatibility class + legacy view adapters
        ↓ normalize config, registrations, and widget metadata
v2 MCPServer
        ↓
official v2 SDK
```

The compatibility `MCPServer` is a facade over the v2 class. It translates v1
constructor options and registration overloads, then delegates to existing v2
methods. The CLI and React package add narrow adapters for the legacy
widget layout and hooks. Protocol handling, view transport, HTTP serving,
lifecycle, Hono routes, and the stateless model remain owned by v2.

This avoids adding v1-only fields to the root v2 types and avoids copying any
session-era implementation.

Keep all compatibility implementation in at most two source files. Small
package-export, barrel-export, and CLI/view call-site edits are expected, but
they should only wire these adapters into existing v2 machinery. Do not create
a compatibility subsystem with separate config, registration, context, OAuth,
discovery, and entry-capture modules.

## Deprecation and removal contract

Ship the compatibility entry already deprecated. The contract should be
unambiguous:

- `mcp-use/server` exists only to give existing v1 servers time to migrate;
- new code, generated code, examples, and agent-authored code should import
  from `mcp-use` and use the native v2 API;
- compatibility receives security fixes and regressions needed for the scoped
  v1 cases, but no new v2 features;
- remove the compatibility entry in `mcp-use` v3.0.0.

Use the same sentence everywhere:

> Deprecated temporary v1 compatibility. Use the native v2 API from
> `mcp-use`. This entry will be removed in mcp-use v3.

If the team does not want to commit to v3, choose another exact release before
shipping. Do not publish vague wording such as “may be removed in a future
version”; agents and users need a concrete removal boundary.

### Make TypeScript and editors steer toward v2

Add `@deprecated` JSDoc to the compatibility `MCPServer`, factory, types,
helpers, OAuth aliases, and every legacy React export. Each annotation should
name the native replacement when one exists:

```ts
/**
 * @deprecated Temporary v1 compatibility. Import MCPServer from "mcp-use".
 * Removed in mcp-use v3.
 */
export class MCPServer {
  // ...
}
```

Do not mark native v2 exports from `mcp-use` or native React hooks as
deprecated. Only symbols reached through `mcp-use/server` and legacy React
names should receive the warning.

### Warn when the bridge is actually used

The compatibility constructor emits one deprecation warning per process
with a stable code such as `MCP_USE_V1_COMPAT`. `mcp-use dev`, `build`, and
`start` trigger the same warning while evaluating a compatibility entry. Never
emit a warning per request or tool call. Add the public migration-guide URL to
the message before release once that URL is stable; the v3 boundary is already
present.

Use Node's standard `DeprecationWarning` where available. This keeps the
default visible while allowing production operators to use Node's normal
deprecation-warning controls; do not invent a compatibility-specific
environment-variable system.

### Keep docs, templates, and agents on the native SDK

The repository must never present the bridge as the default:

- all normal docs, README snippets, examples, scaffolds, skills, and templates
  use `mcp-use` and native v2 registrations;
- document `mcp-use/server` only on the v1 migration page, compatibility API
  page, changelog, and compatibility tests;
- label those pages “Existing v1 servers only” and lead with the native v2
  replacement;
- add a CI repository scan or lint rule that rejects new `mcp-use/server`
  imports outside an explicit compatibility allowlist;
- ensure package/API metadata exposed to documentation and code-completion
  systems carries the same deprecation and removal text.

This is the most important agent-facing control: agents copy current examples,
templates, skills, and type documentation. Keeping those surfaces exclusively
v2 makes the native SDK the path of least resistance.

### Enforce the removal instead of extending the bridge

Track removal as a v3 release item when compatibility ships. Before v3,
publish a migration reminder and remove the subpath export, the two
compatibility implementation files, their CLI wiring, allowlist entries, and
compatibility-only tests together. Do not silently extend the bridge because a
rare unsupported v1 feature appears; document that feature's native migration.

## Compatibility surface

### 1. Restore the server import

Add this package export:

```json
{
  "exports": {
    "./server": {
      "types": "./dist/compat-v1.d.ts",
      "import": "./dist/compat-v1.js"
    }
  }
}
```

`mcp-use/server` should export:

- the compatibility `MCPServer`;
- the common server types;
- response helpers already present in v2;
- all built-in external OAuth provider factories;
- middleware types and helpers that still map cleanly to v2;
- `createMCPServer` as a thin factory if needed by existing code.

Do not re-export every old session and internal type just to match the v1
symbol count. Re-export the widget types that unchanged v1 widget source files
actually import.

### 2. Translate common constructor options

The compatibility constructor should accept the common v1 config and produce
a v2 config.

| v1 option                                                 | Compatibility behavior                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `name`, `version`, `title`, `description`, `instructions` | Pass through                                                             |
| `host`, branding, `publicLandingPage`                     | Pass through                                                             |
| `baseUrl`                                                 | Use its pathname as `basePath`; retain its origin for OAuth/landing URLs |
| `stateless: true`                                         | Accept as a no-op because v2 is stateless                                |
| `stateless: false`                                        | Throw a clear stateful-mode migration error                              |
| `allowedOrigins`                                          | Treat as the v1 Host allowlist and map to `allowedHosts`                 |
| common v1 `cors` fields                                   | Translate to v2 CORS options                                             |
| built-in external OAuth provider                          | Normalize through the matching v2 provider adapter                       |
| session or stream fields                                  | Throw a focused unsupported-feature error                                |

The `allowedOrigins` mapping is essential. The name means Host validation in
v1 but browser-Origin validation in v2. The `/server` compatibility class must
preserve the v1 meaning so an unchanged server does not silently change its
security behavior.

For CORS, support the fields people normally use: `origin`, `allowMethods`,
`allowHeaders`, and `credentials`. Do not rebuild every obscure Hono option
unless a real server needs it.

### 3. Accept common v1 registration forms

#### Tools

Support both common styles:

```ts
server.tool(
  {
    name: "greet",
    schema: z.object({ name: z.string() }),
  },
  async ({ name }) => text(`Hello ${name}`)
);
```

```ts
server.tool({
  name: "greet",
  schema: z.object({ name: z.string() }),
  cb: async ({ name }) => text(`Hello ${name}`),
});
```

Implementation:

- keep `schema` as the existing `inputSchema` alias;
- extract an inline `cb` when present;
- reject definitions that provide both inline and separate callbacks;
- preserve description, annotations, metadata, and output schema;
- map v1 `widget: { name, ... }` to a v2 view binding;
- retain the v1 chainable return value; native v2 entries continue returning
  `ToolRef` handles.

Do not support the deprecated v1 `inputs` array unless real-world feedback
shows it is still common.

#### Static resources

Support separate and inline `readCallback` forms. Adapt the callback arguments
because v1 static resource callbacks received context first, while v2 passes
`(uri, context)`.

Keep the existing v2 conversion from response helpers to
`ReadResourceResult`.

#### Resource templates

Support the common nested and flat shapes:

- `resourceTemplate.uriTemplate` or `uriTemplate`;
- inline or separate `readCallback`;
- `callbacks.complete` mapped to v2 `complete`;
- Zod `schema` for inferred parameters.

Normalize them once, then call the v2 `resourceTemplate` method.

#### Prompts

Support both separate callbacks and inline `cb`. Zod `schema` already maps
cleanly. Keep the existing v2 conversion from helpers such as `text()` to a
prompt result.

Do not restore the deprecated `args` array unless it proves necessary.

### 4. Preserve common helpers

Most response helpers already exist in v2 and can be re-exported unchanged:

- `text`, `markdown`, `html`, `xml`, and `css`;
- `object`, `image`, `binary`, and embedded `resource`;
- raw MCP result types.

Add a compatibility wrapper for `array(data)` so unchanged v1 code keeps its
`structuredContent: { data }` shape. Do not restore filesystem auto-detection
in `audio()` unless there is evidence that it is common; base64 audio remains
supported.

### 5. Keep v1 widgets/views working unchanged

Support the common mcp-use v1 widget contract end to end:

- `resources/<name>/widget.tsx` remains a valid view entry;
- `widgetMetadata` remains a valid metadata export;
- a tool's `widget: { name, invoking, invoked, ... }` remains valid;
- `widget({ props, output, message, metadata })` remains valid;
- `McpUseProvider`, `useWidget`, the split widget hooks, `WidgetControls`,
  `WidgetMetadata`, `ModelContext`, `modelContext`, and `useFiles` remain valid
  imports from `mcp-use/react`;
- existing `mcp-use dev`, `build`, and `start` scripts continue to discover and
  serve these widgets.

Do this with adapters over the v2 view runtime, not by restoring the v1 bridge.

#### Legacy view discovery

Extend view discovery to scan both layouts:

```text
views/<name>/view.tsx          # native v2
resources/<name>/widget.tsx   # v1 compatibility
```

If both exist for the same name, prefer the native v2 view and report the
collision. The Vite view compiler should compile a legacy widget through the
same v2 bootstrap and manifest pipeline as a native view.

#### Metadata and registration

Translate `WidgetMetadata` into v2 view/tool configuration:

- `description`, title, annotations, CSP, border, and domain metadata;
- `props`/`schema` as the tool output schema when available;
- `metadata.autoResize` as `viewConfig.autoResize`;
- `exposeAsTool` and `toolOutput` for v1 auto-registered widgets;
- `invoking`, `invoked`, and widget accessibility metadata;
- custom `server.tool({ widget: { name } })` bindings.

Preserve the two v1 registration modes without requiring new exports:

| Existing v1 widget setup         | Compatibility behavior                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `exposeAsTool: true`             | Discovery registers the widget resource and generates its tool automatically.                                                   |
| `exposeAsTool: false` or omitted | Discovery registers only the widget resource; the user's existing `server.tool({ widget: { name } })` remains its tool binding. |

The omitted case must follow the v1.34.3 runtime behavior, which defaults
`exposeAsTool` to `false`, even though the old `WidgetMetadata` type comment
incorrectly says it defaults to `true`.

Do not make users rewrite this:

```ts
server.tool(
  {
    name: "show-weather",
    schema: z.object({ city: z.string() }),
    widget: { name: "weather-display" },
  },
  async ({ city }) => widget({ props: await getWeather(city) })
);
```

as this just to satisfy v2 view typing:

```ts
export const showWeather = server.tool(/* ... */);
```

Exporting a v2 `ToolRef` is a compile-time convention used by native v2 views
for typed `useCallTool`/`useToolContext` inference. It is not required for
runtime tool registration. Legacy widgets must keep their string-based
`useWidget`/`callTool` path, so the compatibility layer must not require an
exported tool constant or a generated `mcp-env.d.ts` change.

For a widget tool without an explicit `outputSchema`, use its
`widgetMetadata.props` schema. If neither exists, attach a permissive object
schema in compatibility mode so the v2 view contract can carry the
`structuredContent` returned by `widget()`. Do not weaken native v2 view
validation.

Keep the common one-widget/one-tool model. If several tools bind the same v1
widget and the v2 one-to-one rule cannot represent them, report that as a
focused migration instead of creating synthetic aliases.

#### React adapter

Implement the v1 React surface by composing the current v2 hooks:

| v1 API                                | v2 implementation                                                   |
| ------------------------------------- | ------------------------------------------------------------------- |
| `McpUseProvider`                      | `ThemeProvider`, `ViewControls`, and the already-mounted v2 runtime |
| `useWidget().props`                   | ready `toolOutput`, with progressive `toolInput` while pending      |
| `isPending`                           | `useToolContext().status === "pending"`                             |
| `theme`, locale, timezone, dimensions | `useHostContext`/`useViewTheme`                                     |
| `callTool`                            | runtime `callServerTool` with v1 result normalization               |
| `sendFollowUpMessage`                 | `useSendFollowUp`                                                   |
| `openExternal`                        | `useOpenExternal`                                                   |
| `requestDisplayMode`                  | `useDisplayMode`                                                    |
| `useFiles`                            | Existing v2 hook                                                    |
| `ModelContext`/`modelContext`         | Existing v2 implementation                                          |

Expose progressive input state in the internal view snapshot so
`partialToolInput` and `isStreaming` can be adapted without a second event
bridge. Keep `state`/`setState` as view-local state plus v2 model-context
updates; do not introduce server sessions.

`McpUseProvider` must not bootstrap another runtime. Legacy widget entries are
already wrapped by the v2 compiler, so the provider is only a component-level
compatibility wrapper for theme, controls, error handling, and sizing options.

### 6. Reuse restored client helpers and add only cheap aliases

Native v2 now exposes these v1-named methods directly:

- `ctx.client.can(capability)`;
- `ctx.client.capabilities()`;
- `ctx.client.info()`;
- `ctx.client.extension(id)`;
- `ctx.client.user()`.

The `/server` compatibility layer should pass them through unchanged. Do not
wrap or reimplement them: the core already supplies typed, request-scoped
snapshots and returns defensive copies. `user()` reads ordinary request `_meta`
and returns normalized OpenAI-specific hints without session caching. This
removes client capability, implementation, and caller-hint metadata from the
compatibility workload.

Do not add a compatibility wrapper solely for v1's undocumented
`user().timezoneOffsetMinutes` field. Native v2 intentionally ignores that
non-namespaced key and exposes the IANA `location.timezone` hint instead.
Document this as a small migration. The widened `location.latitude` and
`longitude` types (`string | number`) should also be called out for code that
assumed strings.

Only the remaining common aliases are needed:

- `ctx.log(level, message, logger)` delegates to `ctx.sendLog(...)`;
- `ctx.client.supportsApps()` delegates to `supportsViews()`;
- `ctx.req` uses the existing deprecated alias;

Do not reconstruct sessions, sampling, or old blocking elicitation. If called,
those APIs should explain that the server needs a small migration. The restored
metadata helpers, including `user()`, must remain request-scoped; the
compatibility layer must not cache them to imitate v1 sessions.

### 7. Keep direct execution and legacy CLI entries working

An unchanged directly executed v1 entry should continue to work:

```ts
const server = new MCPServer(...);
// registrations
await server.listen();
```

The common `await server.listen()` pattern already ignores the return value and
can delegate directly to v2. Do not add a separate listener implementation
only to reproduce v1's `Promise<void>` type.

For `mcp-use dev/build/start`, add a small compatibility-only entry capture:

1. The compatibility constructor records exactly one current instance in a
   private process-global capture slot while the CLI is evaluating an entry.
2. Compatibility `listen()` does not bind when the CLI declares that it owns
   the socket; it records the requested host/port instead.
3. The CLI prefers a normal default export, otherwise accepts exactly one
   captured compatibility server.
4. The generated build wrapper exports that captured server as its default.
5. Capture state is cleared after every import and reload.

This path activates only for `mcp-use/server`. Native v2 entries retain the
strict default-export/no-`listen()` contract. Reject multiple captured servers
rather than guessing.

### 8. Keep built-in OAuth providers working unchanged

Re-export the current provider factory names from `mcp-use/server` and accept
their v1 option shapes. Cover Auth0, Clerk, WorkOS, Supabase, Keycloak, and
Better Auth.

Translate common option differences, including `audience` to the v2 resource
identity where appropriate, and map the verified v2 provider user back to the
v1 `UserInfo` fields (`userId`, roles, permissions, and provider-specific
claims). Keep `getAuth`, `hasScope`, `hasAnyScope`, `requireScope`, and
`requireAnyScope` working over the adapted context.

Do not preserve `verifyJwt: false`; accepting unsigned tokens would weaken the
v2 security contract. Fail construction with a precise message explaining the
required change.

Do not attempt to emulate v1's OAuth proxy mode. External authorization-server
providers are compatible; a server acting as its own authorization proxy is a
real migration. Custom providers can follow later if real usage justifies the
extra verifier/metadata adapter.

## Proposed files

Use no more than two compatibility implementation files:

1. `src/compat-v1.ts`: the `/server` export, compatibility facade, overload
   normalization, config/helper/OAuth adapters, legacy metadata translation,
   and bounded CLI entry-capture state.
2. `src/react/compat-v1.tsx`: `McpUseProvider`, `useWidget`, split hooks, and
   legacy React types composed over the v2 view runtime.

Existing files may receive small integration edits:

- `package.json` exposes `./server`;
- `src/react/index.ts` re-exports the React adapter;
- existing CLI view discovery scans `resources/<name>/widget.tsx` and calls
  the metadata normalizer from `compat-v1.ts`;
- existing CLI entry loading reads the bounded capture exported by
  `compat-v1.ts`.

Tests may use focused files and fixture directories; the two-file limit is for
shipped compatibility implementation. If a feature requires a third
compatibility module, first try a small generally useful v2 core seam. If it
still does not fit cleanly, leave that feature as an explicit migration rather
than growing a mini v1 framework.

## Tests

### Focused unchanged fixtures

Create small v1-style fixtures that are installed against v2 without source
rewrites:

1. simple tools/resources/prompts with separate callbacks;
2. inline `cb` and `readCallback` registrations;
3. a resource template with completion;
4. text/object/array response helpers;
5. middleware, progress/logging, and unchanged `ctx.client` metadata helpers,
   including common `user()` fields;
6. `baseUrl`, v1 `allowedOrigins`, and common CORS fields;
7. every built-in external OAuth provider with mocked issuer/JWKS endpoints;
8. a legacy `resources/<name>/widget.tsx` using `McpUseProvider`, `useWidget`,
   `widgetMetadata`, and `widget()`;
9. a metadata-only auto-registered widget and a custom widget-bound tool;
10. direct `await server.listen()` plus client initialize/list/call;
11. unchanged legacy widget entry under `mcp-use dev/build/start`;
12. a legacy custom widget-bound tool that is not assigned to an exported
    constant, proving runtime registration does not depend on v2 `ToolRef`
    inference.

Also verify the deprecation boundary:

- emitted declarations contain `@deprecated` plus the native replacement and
  v3 removal text;
- runtime and CLI warnings appear once, not per request;
- native `mcp-use` imports emit no warning;
- the repository import guard rejects `mcp-use/server` outside the allowlist;
- scaffolds and agent-facing examples contain only native v2 imports.

Each fixture must run TypeScript and a live v2 client call. A successful
`mcp-use build` alone is not enough because the build command does not
typecheck.

### Existing v1 examples

Use the v1.34.3 examples as regression evidence, but do not make every unusual
example a release blocker. The expected easy wins are:

- `basic/simple`;
- `features/dns-rebinding` with preserved v1 semantics;
- `features/middleware`;
- `features/openapi`;
- the source-only resource completion example;
- `features/nextjs-drop-in` with its existing MCP directory and widget layout;
- the one-tool-per-view React widget examples under `ui/files` and
  `ui/model-context`;
- all built-in external-provider OAuth examples.

Session management, sampling, notifications, raw `mcp-ui` resources, OAuth
proxy, stdio proxy, shared-view examples (`streaming-props` and `ui/mcp-apps`),
and the all-features conformance example remain documented migrations. The
Apps SDK example is tracked separately because its installed third-party UI
package currently references a missing emitted module.

The capability and per-request caller metadata portions of
`features/client-info` are now natively compatible. The example as a whole is
still not an easy-win fixture because it also uses sessions,
`timezoneOffsetMinutes`, `supportsApps()`, and a legacy widget.

### Regression boundary

Run the normal v2 package typecheck and tests. Add assertions that importing
from `mcp-use` retains the current v2 config types, `allowedOrigins` semantics,
helpers, and registration signatures.

## Delivery status

### Implemented: server compatibility in one file

- Added `mcp-use/server`.
- Implemented the facade, config and registration normalization, response
  differences, remaining context aliases, and CLI capture in `compat-v1.ts`.
- Re-exported common helpers, types, and built-in OAuth providers.
- Marked compatibility exports deprecated and added the once-per-process/CLI
  warning with the v3 removal message.
- Supports direct `listen()`.
- Added type-level and live protocol tests for common server behavior.
- The unchanged simple, DNS, middleware, OpenAPI, Next.js, and direct OAuth
  examples now build from the packed artifact.

### Implemented: React compatibility in one file

- Discovers and builds `resources/<name>/widget.tsx`.
- Translates `widgetMetadata` and tool `widget` bindings.
- Implements `McpUseProvider`, `useWidget`, split hooks, and legacy React types
  in `react/compat-v1.tsx` over the v2 runtime.
- Added compatibility entry capture for unchanged widget CLI scripts.
- Verifies focused widgets through build and live view-resource loading.
- Adds focused unsupported-feature errors, including one-tool-per-view.
- Updates `v2-MIGRATION.md` with the packed-example matrix.

### Remaining release work

- Add the repository import guard and audit docs, templates, scaffolds, and
  agent skills so only migration material teaches the compatibility entry.
- Add the final hosted migration-guide URL to the warning.
- Track the v3 removal as a release item.
- Add mocked issuer/JWKS runtime tests for all provider adapters; the unchanged
  provider examples currently prove packed type/build compatibility.

Stop after these two PRs and reassess actual user feedback. Do not pre-build
compatibility for uncommon APIs.

## Definition of done

- A normal v1 server can keep importing `mcp-use/server`.
- Common constructor options preserve their v1 meaning.
- Common Zod tool/resource/template/prompt registrations compile unchanged.
- Inline and separate callbacks both work.
- Common response helpers work, including v1 array structure.
- `ctx.client.info()`, `capabilities()`, `can()`, `extension()`, and common
  `user()` fields pass through to the native request-scoped v2 implementation
  without source changes; removed `timezoneOffsetMinutes` is documented rather
  than emulated.
- Direct `await server.listen()` works on Node.js 22.22.2+.
- Existing v1 widget directories, metadata, server bindings, React components,
  and CLI scripts work without source changes on the v2 view runtime.
- The Host/CORS semantic difference is tested and safe.
- All built-in external OAuth providers keep the old import, option, and
  callback user shapes, except insecure verification bypasses.
- Stateful, sampling, raw third-party UI, proxy, and internal cases have clear
  migration errors instead of partial emulation.
- The root `mcp-use` v2 API and behavior remain unchanged.
- Shipped compatibility implementation is limited to `compat-v1.ts` and
  `react/compat-v1.tsx`; integration points contain wiring only.
- Every compatibility symbol is deprecated with a native replacement and v3
  removal notice where applicable.
- Compatibility use produces one actionable warning, while native v2 use is
  silent.
- Docs, examples, templates, scaffolds, and agent skills use only native v2;
  CI prevents accidental new compatibility imports outside the allowlist.
- A v3 removal item exists and names every compatibility artifact to delete.
- The implementation stays small enough to maintain for the v2 major line.
