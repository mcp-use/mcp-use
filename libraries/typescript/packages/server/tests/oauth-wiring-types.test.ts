import { MCPServer } from "../src/index.js";
import { toAuthenticatedRequestContext } from "../src/context.js";
import type { OAuthProvider } from "../src/oauth/index.js";
import { oauthAuth0Provider, type Auth0OAuthUser } from "../src/oauth/auth0.js";
import {
  oauthBetterAuthProvider,
  type BetterAuthOAuthUser,
} from "../src/oauth/better-auth.js";
import { oauthClerkProvider, type ClerkOAuthUser } from "../src/oauth/clerk.js";
import {
  oauthKeycloakProvider,
  type KeycloakOAuthUser,
} from "../src/oauth/keycloak.js";
import { oauthCustomProvider } from "../src/oauth/provider.js";
import {
  oauthSupabaseProvider,
  type SupabaseOAuthUser,
} from "../src/oauth/supabase.js";
import {
  oauthScalekitProvider,
  type ScalekitOAuthUser,
} from "../src/oauth/scalekit.js";
import {
  oauthWorkOSProvider,
  type WorkOSOAuthUser,
} from "../src/oauth/workos.js";
import type { OAuthAuth } from "../src/index.js";
import type {
  OAuthMetadata,
  OAuthTokenVerifier,
  ServerContext,
} from "@modelcontextprotocol/server";
import { expect, it } from "vitest";

interface TestUser {
  id: string;
}

declare const provider: OAuthProvider<TestUser>;

function verifyStructuralProviderTyping(
  tokenVerifier: OAuthTokenVerifier,
  oauthMetadata: OAuthMetadata
): void {
  const directProvider: OAuthProvider<TestUser> = {
    createTokenVerifier: () => tokenVerifier,
    oauthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: {},
      permissions: [],
    }),
  };
  void directProvider;

  const resourceBoundProvider: OAuthProvider<TestUser> = {
    resource: "https://api.example.test/mcp",
    bind: (resource) => ({
      oauthMetadata: {
        issuer: new URL("/oauth", resource.origin).href,
      } as OAuthMetadata,
      tokenVerifier,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
      requiredScopes: ["mcp"],
      middleware: async (_request, next) => next(),
    }),
  };
  new MCPServer({
    name: "resource-bound-provider",
    version: "1.0.0",
    oauth: resourceBoundProvider,
  });

  const inferredResourceBoundServer = new MCPServer({
    name: "inferred-resource-bound-provider",
    version: "1.0.0",
    oauth: {
      resource: "https://api.example.test/mcp",
      bind: () => ({
        oauthMetadata,
        tokenVerifier,
        mapAuthInfo: () => ({
          user: { id: "user-1", role: "admin" as const },
          payload: {},
          permissions: [],
        }),
      }),
    },
  });
  inferredResourceBoundServer.tool(
    { name: "bound-user" },
    (_params, context) => {
      const id: string = context.auth.user.id;
      const role: "admin" = context.auth.user.role;
      void [id, role];
      return { content: [] };
    }
  );
}

function assertOAuthAuthFields<TUser>(auth: OAuthAuth<TUser>): void {
  const accessToken: string = auth.accessToken;
  const scopes: string[] = auth.scopes;
  const permissions: string[] = auth.permissions;
  const clientId: string | undefined = auth.clientId;
  const expiresAt: number = auth.expiresAt;
  const resource: URL | undefined = auth.resource;
  const payload: Record<string, unknown> = auth.payload;
  void [
    accessToken,
    scopes,
    permissions,
    clientId,
    expiresAt,
    resource,
    payload,
  ];
}

// This function is intentionally not invoked: tsconfig.test.json typechecks
// the callback contracts while Vitest has no runtime provider to configure.
function verifyOAuthCallbackTyping(): void {
  const authenticated = new MCPServer({
    name: "authenticated",
    version: "1.0.0",
    oauth: provider,
  });
  authenticated.tool({ name: "whoami" }, (_params, ctx) => {
    const user: TestUser = ctx.auth.user;
    const id: string = ctx.auth.user.id;
    return { content: [{ type: "text", text: `${user.id}:${id}` }] };
  });
  authenticated.resource(
    { name: "profile", uri: "user://profile" },
    (_uri, ctx) => {
      const id: string = ctx.auth.user.id;
      return { contents: [{ uri: "user://profile", text: id }] };
    }
  );
  authenticated.resourceTemplate(
    { name: "user", uriTemplate: "user://{id}" },
    (_uri, _params, ctx) => {
      const id: string = ctx.auth.user.id;
      return { contents: [{ uri: "user://user", text: id }] };
    }
  );
  authenticated.prompt({ name: "greet" }, (_params, ctx) => {
    const id: string = ctx.auth.user.id;
    return {
      messages: [{ role: "user", content: { type: "text", text: id } }],
    };
  });

  const clerk = new MCPServer({
    name: "clerk",
    version: "1.0.0",
    oauth: oauthClerkProvider({ frontendApiUrl: "https://clerk.example.com" }),
  });

  const betterAuth = new MCPServer({
    name: "better-auth",
    version: "1.0.0",
    oauth: oauthBetterAuthProvider({
      authURL: "https://auth.example.com/api/auth",
    }),
  });
  betterAuth.tool({ name: "better-auth-user" }, (_params, ctx) => {
    const auth: OAuthAuth<BetterAuthOAuthUser> = ctx.auth;
    const user: BetterAuthOAuthUser = ctx.auth.user;
    const isAnonymous: boolean | undefined = ctx.auth.user.isAnonymous;
    assertOAuthAuthFields(auth);
    void [user, isAnonymous];
    return { content: [] };
  });
  clerk.tool({ name: "clerk-user" }, (_params, ctx) => {
    const auth: OAuthAuth<ClerkOAuthUser> = ctx.auth;
    const user: ClerkOAuthUser = ctx.auth.user;
    const organizationRole: string | undefined = ctx.auth.user.organizationRole;
    assertOAuthAuthFields(auth);
    void [user, organizationRole];
    return { content: [] };
  });

  const auth0 = new MCPServer({
    name: "auth0",
    version: "1.0.0",
    oauth: oauthAuth0Provider({
      domain: "https://tenant.auth0.com",
    }),
  });
  auth0.tool({ name: "auth0-user" }, (_params, ctx) => {
    const auth: OAuthAuth<Auth0OAuthUser> = ctx.auth;
    const user: Auth0OAuthUser = ctx.auth.user;
    const nickname: string | undefined = ctx.auth.user.nickname;
    assertOAuthAuthFields(auth);
    void [user, nickname];
    return { content: [] };
  });

  const workos = new MCPServer({
    name: "workos",
    version: "1.0.0",
    oauth: oauthWorkOSProvider({ subdomain: "https://acme.authkit.app" }),
  });
  workos.tool({ name: "workos-user" }, (_params, ctx) => {
    const auth: OAuthAuth<WorkOSOAuthUser> = ctx.auth;
    const user: WorkOSOAuthUser = ctx.auth.user;
    const sessionId: string | undefined = ctx.auth.user.sessionId;
    assertOAuthAuthFields(auth);
    void [user, sessionId];
    return { content: [] };
  });

  const supabase = new MCPServer({
    name: "supabase",
    version: "1.0.0",
    oauth: oauthSupabaseProvider({ projectId: "example-project" }),
  });
  supabase.tool({ name: "supabase-user" }, (_params, ctx) => {
    const auth: OAuthAuth<SupabaseOAuthUser> = ctx.auth;
    const user: SupabaseOAuthUser = ctx.auth.user;
    const amr: SupabaseOAuthUser["amr"] = ctx.auth.user.amr;
    assertOAuthAuthFields(auth);
    void [user, amr];
    return { content: [] };
  });

  const keycloak = new MCPServer({
    name: "keycloak",
    version: "1.0.0",
    oauth: oauthKeycloakProvider({
      serverUrl: "https://keycloak.example.com",
      realm: "acme",
    }),
  });
  keycloak.tool({ name: "keycloak-user" }, (_params, ctx) => {
    const auth: OAuthAuth<KeycloakOAuthUser> = ctx.auth;
    const user: KeycloakOAuthUser = ctx.auth.user;
    const realmAccess: Record<string, unknown> | undefined =
      ctx.auth.user.realmAccess;
    assertOAuthAuthFields(auth);
    void [user, realmAccess];
    return { content: [] };
  });

  const scalekit = new MCPServer({
    name: "scalekit",
    version: "1.0.0",
    oauth: oauthScalekitProvider({
      environmentUrl: "https://scalekit.example.com",
      resourceId: "res_example",
    }),
  });
  scalekit.tool({ name: "scalekit-user" }, (_params, ctx) => {
    const auth: OAuthAuth<ScalekitOAuthUser> = ctx.auth;
    const user: ScalekitOAuthUser = ctx.auth.user;
    const subjectType: "user" | "machine" = ctx.auth.user.subjectType;
    assertOAuthAuthFields(auth);
    void [user, subjectType];
    return { content: [] };
  });

  const anonymous = new MCPServer({ name: "anonymous", version: "1.0.0" });
  anonymous.tool({ name: "anonymous" }, (_params, ctx) => {
    // @ts-expect-error auth is unavailable without an OAuth provider.
    void ctx.auth.user;
    return { content: [] };
  });

  // @ts-expect-error An authenticated callback type requires a provider.
  new MCPServer<TestUser>({ name: "misconfigured", version: "1.0.0" });

  // @ts-expect-error MCPServer does not expose an OAuth-state type parameter.
  new MCPServer<never, true>({ name: "escape-hatch", version: "1.0.0" });
}

void verifyOAuthCallbackTyping;

it("throws when authenticated callbacks lack mapped AuthInfo", () => {
  expect(() =>
    toAuthenticatedRequestContext<TestUser>({
      mcpReq: { signal: new AbortController().signal },
    } as ServerContext)
  ).toThrow("OAuth callback did not receive mapped AuthInfo.extra");
});

it("omits clientId from callback auth when AuthInfo.clientId is empty", () => {
  const ctx = toAuthenticatedRequestContext<TestUser>({
    mcpReq: { signal: new AbortController().signal },
    http: {
      authInfo: {
        token: "token",
        clientId: "",
        scopes: ["mcp"],
        expiresAt: Date.now() / 1000 + 60,
        extra: {
          user: { id: "user-1" },
          payload: { sub: "user-1" },
          permissions: [],
        },
      },
    },
  } as unknown as ServerContext);

  expect(ctx.auth.clientId).toBeUndefined();
  expect(ctx.auth.user.id).toBe("user-1");
});

it("rejects public OAuth listen without a canonical resource", async () => {
  const server = new MCPServer({
    name: "public-oauth",
    version: "1.0.0",
    host: "0.0.0.0",
    oauth: oauthCustomProvider({
      createTokenVerifier: (resource) => ({
        verifyAccessToken: async () => ({
          token: "token",
          clientId: "client",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource,
        }),
      }),
      oauthMetadata: { issuer: "https://issuer.example.com" } as OAuthMetadata,
      mapAuthInfo: () => ({
        user: { id: "user" },
        payload: {},
        permissions: [],
      }),
    }),
  });

  const originalMcpUrl = process.env["MCP_URL"];
  try {
    delete process.env["MCP_URL"];
    await expect(server.listen(0)).rejects.toThrow(
      "OAuth listen() on a public or wildcard host requires an explicit provider resource or valid MCP_URL."
    );
  } finally {
    if (originalMcpUrl === undefined) {
      delete process.env["MCP_URL"];
    } else {
      process.env["MCP_URL"] = originalMcpUrl;
    }
  }
});
