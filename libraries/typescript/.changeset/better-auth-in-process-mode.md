---
"mcp-use": minor
---

Add in-process mode to `oauthBetterAuthProvider`. The function now accepts a Better Auth instance directly — the SDK mounts Better Auth's API handler under the MCPServer's `basePath` and serves OAuth discovery (`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`, including the RFC 8414 §3.1 path-insertion variants) at the host root automatically. Discovery routes are synthesized locally via `auth.api.getOAuthServerConfig` / `auth.api.getOpenIdConfig`, so no upstream fetch is involved and no extra wiring is required.

### Before

```typescript
const server = new MCPServer({
  basePath: "/mcp-server",
  oauth: oauthBetterAuthProvider({
    authURL: "http://localhost:3000/mcp-server/api/auth",
  }),
});

// Developer had to mount everything manually. `server.app` is the basePath
// clone, so well-known endpoints registered through it ended up under
// /mcp-server/.well-known/* — silently broken because RFC 8414 §3.1 requires
// the path-insertion variant at the literal host root.
server.app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));
server.app.get("/.well-known/oauth-authorization-server", authServerHandler);
server.app.get("/.well-known/oauth-authorization-server/api/auth", authServerHandler);
server.app.get("/.well-known/openid-configuration", openIdHandler);
server.app.get("/.well-known/openid-configuration/api/auth", openIdHandler);
```

### After

```typescript
const server = new MCPServer({
  basePath: "/mcp-server",
  oauth: oauthBetterAuthProvider(auth),
});
```

Set `auth.options.basePath` to where Better Auth should live inside the MCPServer's basePath — e.g. `basePath: "/mcp-server/api/auth"` with `baseURL: "http://localhost:3000"`. Better Auth signs tokens with `${baseURL}${basePath}` as the issuer, advertises every endpoint anchored on it, and the SDK mounts `auth.handler` at the same path. Anchoring Better Auth at a sub-path of the MCPServer basePath (rather than the basePath itself) keeps `auth.handler` from shadowing routes like the MCP transport. The SDK mirrors Better Auth's own `withPath` resolution, so passing the full path via `baseURL` works identically if you prefer.

### External mode unchanged

Pass `{ authURL }` for a Better Auth deployment running on a separate origin:

```typescript
oauthBetterAuthProvider({ authURL: "https://auth.example.com/api/auth" })
```

The two modes are mutually exclusive — the argument shape selects the mode (a Better Auth instance has `handler` + `options`; a config object doesn't).

### Provider hook (for library authors)

`OAuthProvider` gains three optional hooks for custom providers:

- `authorizationServerMetadataHandler?(req: Request): Response | Promise<Response>` — replaces the default upstream-fetch behavior on `.well-known/oauth-authorization-server`
- `openIdConfigurationMetadataHandler?` — same, for `.well-known/openid-configuration`
- `installRoutes?(rootApp: Hono, basePath: string): void` — mount provider-specific routes on the root Hono app after defaults are registered
