# Migrating mcp-use servers from v1 to v2

> Implementation snapshot: v1 `mcp-use@1.34.3` (`d5849706`, 2026-07-08) to
> v2 `mcp-use@2.0.0-beta.31` plus the temporary compatibility implementation
> in this working tree, 2026-07-22.
>
> v2 is still a beta. This document describes both the temporary drop-in bridge
> for existing servers and the native v2 API that all servers should migrate to.

For the common stateless v1 server, v2 now provides a deprecated drop-in bridge:
keep the `mcp-use/server` import and upgrade the dependency. Tools, resources,
prompts, middleware, single-tool widgets, OpenAPI servers, and direct built-in
OAuth providers can continue running while the application migrates.

The bridge is deliberately incomplete. Session APIs, sampling, arbitrary
notifications, blocking elicitation, OAuth proxy mode, raw `mcp-ui`, stdio
proxying, and binding one widget to several tools require a real migration.
The native v2 API also changes the import, runtime, CLI entry, registration
shape, and view model.

The native migration path for a basic tool/resource/prompt server is:

1. Upgrade to Node.js 22.22.2 or newer.
2. Replace `mcp-use/server` imports with `mcp-use`.
3. Make the project ESM.
4. Convert registrations to the v2 definition-plus-callback form.
5. Default-export the server from the CLI entry and remove `server.listen()`
   from that entry.
6. Return raw MCP wire results from callbacks.
7. Run a real TypeScript check. `mcp-use build` bundles code but does not prove
   that a v1 project is type-compatible.

## Temporary compatibility bridge

Existing v1 servers may keep this import during migration:

```ts
import { MCPServer, text } from "mcp-use/server";
```

No server-source rewrite is needed for the supported common cases. Existing
top-level `await server.listen()` calls and CLI entries without a default
export are captured by `mcp-use dev`, `build`, and `start`. Legacy
`resources/<name>/widget.tsx` views continue through the v2 view compiler, and
their tools do not need to be assigned to exported constants.

This entry is deprecated from its first release. Editors expose `@deprecated`
on its public symbols and the constructor emits one process-level warning:

> Deprecated temporary v1 compatibility. Use the native v2 API from
> `mcp-use`. This entry will be removed in mcp-use v3.

Do not use `mcp-use/server` for new code. Compatibility receives fixes only for
the scope documented here and will not expose new v2 features.

### Supported without source changes

- Zod/Standard Schema tools, static resources, resource templates, and prompts,
  with inline or separate callbacks;
- response helpers, including the v1 `{ data }` array shape;
- Hono HTTP routes and common middleware;
- v1 `baseUrl`, Host allowlist, and common CORS option normalization;
- `ctx.log`, `ctx.req`, `ctx.client.supportsApps()`, and native
  `ctx.client.can/capabilities/info/extension/user`;
- `MCPServer.fromOpenAPI()`;
- direct Auth0, Clerk, Keycloak, Supabase, WorkOS, and Better Auth providers;
- one tool per legacy view, `widgetMetadata`, `McpUseProvider`, `useWidget`,
  split legacy hooks, `ModelContext`, and `useFiles`.

### Explicitly unsupported

- session stores, active sessions, session/stream managers, roots callbacks,
  sampling, and arbitrary or per-session notification APIs;
- v1 blocking elicitation and its result shape;
- `oauthProxy`, `jwksVerifier`, and authorization-server proxy mode;
- raw `uiResource`/`@mcp-ui/server` adapters and stdio child-process proxies;
- `inputs`/`args` array schemas, `verifyJwt: false`, CommonJS, and Node.js 20;
- more than one tool bound to the same view. The bridge throws immediately and
  instructs the server to use one tool per view or migrate to native v2.

## Minimal server migration

### v1

```ts
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "example",
  version: "1.0.0",
});

server.tool({
  name: "greet",
  schema: z.object({ name: z.string() }),
  cb: async ({ name }) => text(`Hello, ${name}!`),
});

await server.listen();
```

### v2 CLI entry

```ts
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "example",
  version: "2.0.0",
});

server.tool(
  {
    name: "greet",
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  })
);

export default server;
```

Run that entry through `mcp-use dev`, `mcp-use build`, or `mcp-use start`.
The CLI owns the HTTP listener, so a CLI entry must default-export the server
and must not call `listen()` itself.

For a standalone Node script, calling `await server.listen()` is still valid.
It now resolves to `{ port, url }`:

```ts
const { url } = await server.listen();
console.log(url);
```

## Package and runtime changes

| Concern          | v1                                            | v2                                                         |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Server import    | `mcp-use/server`                              | `mcp-use`                                                  |
| Module formats   | ESM and CommonJS exports                      | ESM import export only                                     |
| Node.js          | `^20.19.0 \|\| >=22.12.0`                     | `>=22.22.2`                                                |
| Server runtime   | Sessionful server and transport objects       | Stateless, one server execution per request                |
| CLI entry        | Entry commonly calls `listen()`               | Entry default-exports `MCPServer`; CLI listens             |
| Direct HTTP API  | Framework adapters and server internals       | Web-standard `server.fetch`, Hono routes, and `server.app` |
| Client/agent API | Also exported from the `mcp-use` package root | Split into `@mcp-use/client` and `@mcp-use/agent`          |

The v2 package has dedicated exports for `mcp-use/react`, `mcp-use/oauth`,
provider-specific OAuth adapters, `mcp-use/node`, `mcp-use/next`, and
`mcp-use/landing`.

## Material v2 API changes reviewed

The comparison followed the complete server history from the v1.34.3 release
commit (which is also the merge base) through the current v2 head, plus the
current request-client metadata diff. These changes materially affect the
public migration surface:

| Commit       | Public API consequence                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `f7d3d106`   | Scaffolded the greenfield official-SDK v2 server. This is the architectural break from the v1 sessionful implementation.        |
| `462a0bba`   | Renamed tool `schema` to `inputSchema`, retaining `schema` as an alias.                                                         |
| `e6e0c321`   | Removed `McpUseProvider` and added the v2 view configuration/hook model.                                                        |
| `c8118801`   | Added external OAuth authorization-server/resource-server support.                                                              |
| `db131800`   | Added stateless elicitation/input-required support.                                                                             |
| `389c7b84`   | Added the OpenAPI constructor surface retained by the v1 example.                                                               |
| `9f9aacda`   | Removed the interim `mountMcp` API.                                                                                             |
| `6737ecc4`   | Added middleware, observer events, CORS, and the universal handler surface; `getHandler` is now deprecated in favor of `fetch`. |
| `40545102`   | Added v2 resource-template completions.                                                                                         |
| `fa574030`   | Added title, icons, favicon, and website branding fields.                                                                       |
| `adebe071`   | Added namespaced multi-server HTTP proxying.                                                                                    |
| `15798394`   | Raised the public Node.js floor to 22.22.2.                                                                                     |
| `6aa0857b`   | Made MCP operation middleware method-aware and type-safe.                                                                       |
| `78266950`   | Added the Next.js adapter and entry/view discovery configuration.                                                               |
| `c06ae528`   | Restored the direct Hono HTTP surface and made view tool references strict.                                                     |
| Working tree | Restored typed, request-scoped `ctx.client.can()`, `capabilities()`, `info()`, `extension()`, and `user()` accessors.           |

This history and current diff matter when reading older v2 beta examples: APIs such as
`mountMcp`, provider-wrapped views, or `getHandler` may have existed during the
beta but are not the preferred public surface in the assessed snapshot.

## Registration API

### Tools

The callback is always the second argument. `inputSchema` is the preferred
field; `schema` remains as a deprecated alias.

```ts
export const weather = server.tool(
  {
    name: "weather",
    description: "Get the weather",
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ temperature: z.number() }),
  },
  async ({ city }, ctx) => {
    const result = { temperature: 21 };
    await ctx.sendLog("info", `Looked up ${city}`);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  }
);
```

The returned `ToolRef` is useful for typed views. If a tool declares an
`outputSchema`, a successful result must include matching
`structuredContent`. An error result may instead set `isError: true`.

The v1 `inputs` field and inline `cb` field are gone. `widget` becomes `view`,
and v2 adds `visibility` for model/app visibility.

### Resources

Register the definition and reader separately and return a raw
`ReadResourceResult`:

```ts
server.resource(
  {
    name: "settings",
    uri: "app://settings",
    mimeType: "application/json",
  },
  async (uri, ctx) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ theme: "dark" }),
      },
    ],
  })
);
```

The v1 `readCallback`/`callbacks` fields are no longer part of the resource
definition. v2 temporarily accepts helper-shaped tool results in resource
callbacks for compatibility, but raw `{ contents: [...] }` is the public wire
shape to target.

### Resource templates and completion

Use `uriTemplate`, put completion functions in `complete`, and pass the reader
as the second argument:

```ts
server.resourceTemplate(
  {
    name: "user",
    uriTemplate: "users://{id}",
    complete: {
      id: async (value) =>
        ["alice", "bob"].filter((id) => id.startsWith(value)),
    },
  },
  async (uri, { id }) => ({
    contents: [{ uri: uri.href, text: `User ${id}` }],
  })
);
```

This replaces the v1 `resourceTemplate`, `schema`, and inline
`readCallback` form.

### Prompts

Prompt definitions and callbacks are also separate:

```ts
server.prompt(
  {
    name: "review",
    schema: z.object({ code: z.string() }),
  },
  async ({ code }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Review this code:\n${code}` },
      },
    ],
  })
);
```

The v1 inline `cb` and `args` fields are gone.

## Callback context

The v2 request context is request-scoped. Its main public members are:

- `ctx.auth`: verified OAuth data, including `user`, token payload, scopes,
  permissions, access token, and optional client/resource metadata.
- `ctx.client`: request-scoped client metadata and capability helpers:
  `capabilities()`, `info()`, `can(name)`, `extension(id)`, and
  `supportsViews()`, plus `user()` for normalized OpenAI-specific request
  `_meta`. These values are unverified; do not use them for authorization.
- `ctx.elicit(...)`: stateless input-required flow.
- `ctx.inputResponses`: input responses supplied when a client retries a tool.
- `ctx.reportProgress(...)`: progress reporting.
- `ctx.request`: the Hono request; its raw Web `Request` is
  `ctx.request.raw`.
- `ctx.requestState`: state echoed across input-required rounds.
- `ctx.sendLog(...)`: send an MCP log event.
- `ctx.signal`: request cancellation signal.
- Hono context members for middleware and routing.

The v1 capability and implementation helpers now carry over with the same call
sites:

```ts
ctx.client.info();
ctx.client.capabilities();
ctx.client.can("elicitation");
ctx.client.extension("io.modelcontextprotocol/ui");
```

Their lifecycle is intentionally different. v1 obtained this data from the
connection/session, while v2 reads the current request's modern metadata
envelope. A legacy request without that envelope returns `{}` from `info()` and
`capabilities()`, `false` from `can()`, and `undefined` from `extension()`.
Accessors return shallow copies, and their official SDK types are
`Partial<Implementation>` and `ClientCapabilities` rather than v1's broad
records.

`ctx.client.user()` also carries over, but its source is ordinary request
`_meta`, not MCP's reserved client envelope. It recognizes the currently
documented OpenAI locale, user-agent, location, subject, session, and
organization keys, returns a fresh normalized object on every read, and
returns `undefined` when none is present. These values are client-reported
hints, including `subject`, `conversationId`, and `organizationId`; use
`ctx.auth.user` for authenticated identity.

The common v1 fields remain: `locale`, `userAgent`, `location`, `subject`, and
`conversationId`. v2 adds `organizationId`, accepts either strings or finite
numbers for location coordinates, and does not expose v1's undocumented
`timezoneOffsetMinutes`/`timezone_offset_minutes` hint. Code using that field
must remove it or derive an offset in application code from the supplied IANA
`location.timezone`.

In native v2, the remaining v1 context members that do not carry over include
`ctx.session`, `ctx.log(...)`, and `ctx.sample(...)`, and
`ctx.client.supportsApps()` is renamed to `supportsViews()`. The temporary
`mcp-use/server` bridge keeps `ctx.log(...)` and `supportsApps()` as thin
aliases. It does not reconstruct sessions or sampling. Use `ctx.auth.user` for
authenticated users and `ctx.sendLog(...)` in migrated code.

## Stateless runtime: features that need redesign

v2 does not expose the v1 session store, stream manager, native server, active
session registry, or per-session notification APIs. These public v1 APIs have
no one-to-one replacement:

- `SessionStore`, `InMemorySessionStore`, `RedisSessionStore`, session and
  stream manager types
- `getActiveSessions()` and session metadata
- `sendNotification()`, `sendNotificationToSession()`, and arbitrary
  per-session push
- `onRootsChanged()`
- server-to-client sampling
- `nativeServer`, `server`, `registeredTools`, `registeredResources`, and
  related transport internals

State needed by tools should move to application storage keyed by an
authenticated user, tenant, or domain identifier. Do not key business state
to an MCP transport session.

v2 still accepts 2025-era protocol requests. `legacy: "stateless"` is the
default and handles each legacy request independently; legacy GET/DELETE
session operations return 405. Set `legacy: "reject"` for a modern-only
endpoint.

### Notifications

The supported invalidation APIs are now cross-request subscription events:

```ts
await server.notifyToolsChanged();
await server.notifyPromptsChanged();
await server.notifyResourcesChanged();
await server.notifyResourceUpdated("app://settings");
```

They replace list/resource-change use cases, not arbitrary per-session
messages.

### Elicitation / input required

v1 suspended a live session while awaiting `ctx.elicit({ action, ... })`. v2
is stateless: the first call returns an input-required result, the client
collects input and retries the tool, and the response is available on the
next request.

```ts
server.tool(
  {
    name: "book",
    inputSchema: z.object({ flight: z.string() }),
  },
  async ({ flight }, ctx) => {
    const response = await ctx.elicit(
      "confirm-booking",
      `Book ${flight}?`,
      z.object({ confirmed: z.boolean() })
    );

    if (response.status === "required") return response.result;
    if (response.status !== "accept" || !response.data.confirmed) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Perform side effects only after accepted input is present.
    return { content: [{ type: "text", text: "Booked" }] };
  }
);
```

The stable key is required. The v1 `action` and timeout options do not apply,
and enum elicitation helper exports were removed.

## HTTP, middleware, and deployment

### Web-standard and Hono integration

`MCPServer` exposes `fetch`, Hono route methods, and `app`:

```ts
server.use(async (ctx, next) => {
  ctx.header("x-service", "example");
  await next();
});

server.get("/health", (ctx) => ctx.json({ ok: true }));

export default server;
```

The v1 Express/Connect adapters, including `adaptConnectMiddleware`, were
removed. Use Hono middleware directly. If an existing Node framework needs a
Node `(req, res)` handler, adapt the Web handler with `mcp-use/node`:

```ts
import { toNodeHandler } from "mcp-use/node";

const handler = toNodeHandler(server);
```

`getHandler()` remains only as a deprecated alias; prefer `server.fetch`.

For Deno or another Web runtime, pass `server.fetch` to the platform HTTP
adapter rather than calling the Node-only `listen()`.

### Next.js

v2 uses the `mcp-use/next` adapter:

```ts
// next.config.ts
import { withMcpUse } from "mcp-use/next";

export default withMcpUse({}, { mcpDir: "src/mcp" });
```

```ts
// app/api/mcp/[[...path]]/route.ts
import { createNextHandler } from "mcp-use/next";
import server from "@/mcp/server";

export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);
```

Use the conventional MCP entry/views layout or configure `entry`, `mcpDir`,
and `viewsDir` explicitly. `withMcpUse` also includes the generated view
artifacts in Next.js output tracing.

### Listener and URL configuration

- v2 binds `127.0.0.1` by default. Configure `host`/`port` or use `HOST`/`PORT`.
- `baseUrl` was removed. Use `basePath` for the route path.
- Set `MCP_URL` when the server needs its externally visible canonical origin
  for OAuth metadata or public assets.
- `listen()` returns `{ port, url }`; v1 returned `void`.

## Security and CORS

This migration contains a silent semantic break: the same
`allowedOrigins` property name means different things.

| v1 configuration                                                 | v2 configuration                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `allowedOrigins` controlled Host-header/DNS-rebinding validation | `allowedHosts` controls Host-header/DNS-rebinding validation                      |
| CORS was permissive by default                                   | CORS is off unless `cors` is configured                                           |
| No separate request-Origin allowlist                             | `allowedOrigins` validates the browser `Origin` hostname on non-GET/HEAD requests |

Migrate a v1 host allowlist like this:

```ts
const server = new MCPServer({
  name: "secure-server",
  version: "2.0.0",
  allowedHosts: ["api.example.com"],
  allowedOrigins: ["app.example.com"],
  cors: {
    origin: "https://app.example.com",
    credentials: true,
  },
});
```

`allowedOrigins` and `cors` solve different problems: the former rejects
untrusted browser request origins; the latter tells a browser which responses
it may read. v2 localhost listeners also enable localhost Host/Origin
protection automatically.

The v2 CORS shape uses `methods`, `allowedHeaders`, `credentials`, `origin`,
and optional `enabled`; it is not the v1/Hono `allowMethods` shape.

## OAuth

v2 is an OAuth resource server backed by an external authorization server. It
does not carry forward v1's built-in OAuth proxy/authorization-server mode,
`oauthProxy`, `jwksVerifier`, `mountOAuthProxy`, or the Auth0 proxy example.

Provider adapters moved from the root server import to subpaths:

```ts
import { MCPServer } from "mcp-use";
import { oauthAuth0Provider, type Auth0OAuthUser } from "mcp-use/oauth/auth0";

const server = new MCPServer<Auth0OAuthUser>({
  name: "protected-server",
  version: "2.0.0",
  oauth: oauthAuth0Provider({
    domain: process.env.AUTH0_DOMAIN!,
    resource: process.env.MCP_URL!,
    requiredScopes: ["read:data"],
  }),
});

server.tool({ name: "me" }, async (_input, ctx) => ({
  content: [{ type: "text", text: JSON.stringify(ctx.auth.user) }],
}));
```

Available provider subpaths and their primary locator are:

| Provider    | Import and factory                                     | Primary option               |
| ----------- | ------------------------------------------------------ | ---------------------------- |
| Auth0       | `mcp-use/oauth/auth0`: `oauthAuth0Provider`            | `domain`                     |
| Clerk       | `mcp-use/oauth/clerk`: `oauthClerkProvider`            | `frontendApiUrl`             |
| WorkOS      | `mcp-use/oauth/workos`: `oauthWorkOSProvider`          | `subdomain`                  |
| Supabase    | `mcp-use/oauth/supabase`: `oauthSupabaseProvider`      | `projectId` or `supabaseUrl` |
| Keycloak    | `mcp-use/oauth/keycloak`: `oauthKeycloakProvider`      | `serverUrl` and `realm`      |
| Better Auth | `mcp-use/oauth/better-auth`: `oauthBetterAuthProvider` | `authURL`                    |

Shared resource-server options include `resource`, `requiredScopes`,
`scopesSupported`, `resourceName`, and `serviceDocumentationUrl`.

The old `ctx.user`, `getAuth`, `hasScope`, and `requireScope` patterns should
be replaced with `ctx.auth.user`, `ctx.auth.scopes`, and application-level
authorization checks. A typed `MCPServer<User>` requires an OAuth provider,
so authenticated context cannot be declared without runtime authentication.

## Proxies

v2 `server.proxy(...)` accepts HTTP remote configurations or a ready v2
`@mcp-use/client` connection. The v1 stdio shape `{ command, args, env }` and
`mountMcpProxy` helper are not supported.

```ts
await server.proxy({
  remote: {
    url: "https://example.com/mcp",
  },
});
```

Stdio-backed proxy deployments need to move that process boundary outside the
v2 server or establish an appropriate v2 client connection before proxying.

## MCP Apps / views

v1 widgets and its three UI integrations do not migrate by renaming imports.
v2 has one MCP Apps view model.

| v1                                          | v2                                                             |
| ------------------------------------------- | -------------------------------------------------------------- |
| `resources/<name>/widget.tsx`               | `views/<name>/view.tsx`                                        |
| `widget` on a tool                          | `view: { name: "<name>" }`                                     |
| `uiResource`, `WidgetMetadata`, UI adapters | Generated MCP App resource from the view manifest              |
| `McpUseProvider`                            | No provider; default-export the view component                 |
| `useWidget()` / `useWidgetProps()`          | `useToolContext<"tool-name">()`                                |
| `useWidgetState()`                          | Application state; model-visible state moves to `ModelContext` |
| `useWidgetTheme()`                          | `useViewTheme()`                                               |
| `useWidgetOpenExternal()`                   | `useOpenExternal()`                                            |

A view-bound tool must declare an `outputSchema`, return matching
`structuredContent`, and should export its returned `ToolRef` for the view:

```tsx
// views/weather/view.tsx
import { useToolContext } from "mcp-use/react";

export default function WeatherView() {
  const view = useToolContext<"weather">();
  if (view.status !== "ready") return <p>Loading…</p>;
  return <p>{view.toolOutput.temperature}</p>;
}
```

The generated `mcp-env.d.ts` registers exported tool refs, so the tool-name
generic above resolves the input and output types without importing server
runtime code into the view.

Other v2 view hooks include `useCallTool`, `useDynamicTool`, `useFiles`,
`useHostContext`, `useDisplayMode`, `useOpenExternal`, `useSendFollowUp`, and
`useSendSizeChanged`. Use `visibility: "app"` for app-only tools.

The temporary `mcp-use/server` bridge discovers the old
`resources/**/widget.tsx` layout and compiles it through the same v2 view
pipeline. It supports one tool per view. Native `mcp-use` entries continue to
use only `views/<name>/view.tsx`; move the source and hooks when completing the
migration.

## Response helpers

The v1 helpers such as `text`, `object`, `array`, `image`, and `audio` are
exported by the temporary entry and deprecated there. Prefer the official raw
result shapes shown throughout this guide.

There are two behavior changes to check if helpers remain temporarily:

- Native v2 `array(data)` puts the array itself in `structuredContent`; the
  temporary entry preserves v1's `{ data }` wrapper.
- `audio(data, mimeType)` expects base64 data. It no longer reads a filesystem
  path.

Resources should return `{ contents: [...] }`, prompts should return
`{ messages: [...] }`, and tools should return `CallToolResult` with
`content`, optional `structuredContent`, and optional `isError`.

## Public API inventory findings

A TypeScript compiler-symbol comparison of the published v1
`mcp-use/server` entry and the packed v2 `mcp-use` entry found:

- 178 public v1 symbols
- 139 public v2 symbols
- 49 names shared by both entries

Counts include both runtime values and exported types. The low intersection is
expected because v2 exposes official result types and new stateless request,
event, proxy, view-manifest, logging, and `ToolRef` types, while v1 exposed
session/transport internals, OAuth proxy helpers, enum elicitation helpers,
and multiple widget adapters.

Notable retained or replacement APIs:

| v1                                           | v2                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `MCPServer`                                  | `MCPServer` with a stateless implementation                                            |
| `schema`                                     | `inputSchema` (`schema` is a deprecated alias)                                         |
| Inline `cb` / `readCallback`                 | Separate callback argument                                                             |
| `baseUrl`                                    | `basePath` plus external `MCP_URL`                                                     |
| Express/Connect adapters                     | Hono middleware, `server.fetch`, or `toNodeHandler`                                    |
| `ctx.log`                                    | `ctx.sendLog`                                                                          |
| `ctx.user`                                   | `ctx.auth.user`                                                                        |
| `ctx.client.info/capabilities/can/extension` | Same methods on request-scoped `ctx.client`                                            |
| `ctx.client.user()`                          | Same method for common request-scoped OpenAI `_meta` hints; no `timezoneOffsetMinutes` |
| `ctx.client.supportsApps()`                  | `ctx.client.supportsViews()`                                                           |
| Session notifications                        | List/resource invalidation methods only                                                |
| v1 OAuth helpers at root                     | Provider-specific `mcp-use/oauth/*` exports                                            |
| Widgets/UI adapters                          | MCP Apps views and `mcp-use/react` hooks                                               |
| Stdio proxy config                           | HTTP remote or ready v2 client connection                                              |

## v1 example compatibility audit

### Method

The final compatibility audit used all 28 server examples shipped with v1.34.3.
Each project was copied to an isolated workspace, its dependency alone was
changed to a locally packed `mcp-use@2.0.0-beta.31` containing the working-tree
compatibility code, and dependencies were freshly installed. Source imports,
registrations, listeners, widget files, and OAuth configuration were not
rewritten.

The audit ran the project's TypeScript configuration when present and
`mcp-use build` when the example defined a build script. These are separate
signals: the CLI intentionally transpiles without type-checking, so a build may
succeed for a server that still references an unsupported runtime API.

### Results

| Example group                                                                                          | Packed compatibility result                         | Finding                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic/simple`, `features/middleware`                                                                  | Type and build pass                                 | Common registrations, middleware, unchanged `listen()`, and no default export work.                                                                                                |
| `features/dns-rebinding`                                                                               | Build pass; no project tsconfig                     | The bridge preserves v1 `allowedOrigins` Host semantics.                                                                                                                           |
| `features/openapi`                                                                                     | Type pass                                           | `MCPServer.fromOpenAPI` and its public types are retained.                                                                                                                         |
| `features/nextjs-drop-in`                                                                              | Type and build pass                                 | The unchanged MCP directory, legacy widget, Next path aliases, and `jsx: "preserve"` build.                                                                                        |
| `oauth/auth0`, `clerk`, `keycloak`, `supabase`, `workos`                                               | Type and build pass                                 | Direct built-in providers retain the old import and authenticated callback shape.                                                                                                  |
| `oauth/better-auth`                                                                                    | Build pass; unrelated declaration portability error | The compatibility API resolves; the old example's exported inferred Better Auth type is not portable across its installed Zod copies.                                              |
| `ui/files`, `ui/model-context`                                                                         | Build pass                                          | Single-tool legacy widget directories compile unchanged. Their old package manifests omit React type declarations, so standalone strict TypeScript reports missing `@types/react`. |
| `features/client-info`                                                                                 | Build pass; expected type failures                  | Native client helpers and the compat aliases work; session access and `timezoneOffsetMinutes` remain unsupported.                                                                  |
| `features/conformance`, `elicitation`, `everything`, `notifications`, `sampling`, `session-management` | Build pass; expected type failures                  | Transpilation succeeds, but the type errors correctly identify excluded session, sampling, notification, and blocking-elicitation APIs.                                            |
| `features/streaming-props`, `ui/mcp-apps`                                                              | Expected build failure                              | Both bind one view to multiple tools. The bridge fails immediately with the one-tool-per-view migration message.                                                                   |
| `oauth/auth0-proxy`, `features/public-landing-page`                                                    | Expected type failure                               | OAuth proxy helpers are deliberately absent.                                                                                                                                       |
| `ui/mcp-ui`                                                                                            | Expected type failure                               | Raw `uiResource` adapters are deliberately absent; its transpile-only build is not runtime compatibility.                                                                          |
| `features/proxy`, `features/express-middleware`                                                        | No build/type script                                | Their stdio and Connect-specific APIs remain migrations.                                                                                                                           |
| `ui/mcp-apps/apps-sdk`                                                                                 | Build failure outside mcp-use                       | The installed `@openai/apps-sdk-ui@0.2.2` package references a missing emitted module before mcp-use view registration.                                                            |

The unchanged simple server was also started from the packed artifact on an
ephemeral port. It printed the single deprecation warning and served the MCP
endpoint successfully, proving that legacy top-level `listen()` and CLI entry
capture work beyond compilation.

## Migration checklist

This checklist completes the move off the temporary bridge. A supported
existing server may defer these source changes during the v2 line, but must
finish them before upgrading to v3.

- [ ] Runtime is Node.js 22.22.2+ where Node is used.
- [ ] Package is ESM and no code imports `mcp-use/server`.
- [ ] CLI entry default-exports the server and does not call `listen()`.
- [ ] `schema` is migrated to `inputSchema` on tools.
- [ ] Tool/resource/prompt/template callbacks are separate arguments.
- [ ] Successful output-schema tools return matching `structuredContent`.
- [ ] Resource and prompt callbacks return their raw protocol result shapes.
- [ ] v1 `allowedOrigins` host entries moved to `allowedHosts`.
- [ ] Browser request origins and CORS are configured independently.
- [ ] `baseUrl` is replaced with `basePath` and, when needed, `MCP_URL`.
- [ ] Session stores, active sessions, roots, sampling, and direct notifications
      are removed or redesigned.
- [ ] Elicitation uses a stable key and handles request retry.
- [ ] Client capability checks continue through `ctx.client`; replace only
      `supportsApps()` with `supportsViews()`. Keep `user()` request-scoped and
      untrusted; remove session assumptions and any `timezoneOffsetMinutes`
      access.
- [ ] OAuth uses an external authorization-server adapter from
      `mcp-use/oauth/*`.
- [ ] Views live under `views/<name>/view.tsx` and use `mcp-use/react` v2 hooks.
- [ ] Proxy configuration is HTTP or a ready v2 client connection, not stdio.
- [ ] Edge/framework integrations use `server.fetch`, Hono, `mcp-use/node`, or
      `mcp-use/next` as appropriate.
- [ ] `tsc --noEmit` (or the project's real typecheck script) passes.
- [ ] The built server is started and exercised with a v2 client; view assets,
      OAuth metadata, CORS, and Host/Origin rejection are tested where applicable.

## Assessment conclusion

The temporary entry now covers the common stateless server while users migrate;
it is not a permanent second API. A codemod can safely cover the package import,
common registration syntax,
CLI default export, `baseUrl`/`basePath`, `supportsApps()`/`supportsViews()`,
and some helper renames. The restored `ctx.client.info()`, `capabilities()`,
`can()`, `extension()`, and `user()` method calls need no syntactic migration.
The removed `user().timezoneOffsetMinutes` field still requires a small source
change. A codemod cannot safely automate the stateless redesign, OAuth proxy
removal, security allowlist semantics, sampling/session notifications, stdio
proxying, or the UI
rewrite. Those areas need explicit application decisions and should be called
out as migration blockers before a user upgrades.
