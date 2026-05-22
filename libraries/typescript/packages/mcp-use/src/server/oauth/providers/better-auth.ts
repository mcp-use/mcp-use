/**
 * Better Auth OAuth Provider
 *
 * Two modes, distinguished by what you pass at construction:
 *
 * - **In-process** (`{ auth }`): The SDK mounts Better Auth's API handler on
 *   the MCP server's root Hono app and serves OAuth discovery metadata
 *   (`.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`)
 *   itself by delegating to `auth.api.getOAuthServerConfig` /
 *   `auth.api.getOpenIdConfig`. The well-known endpoints land at the literal
 *   host root regardless of MCPServer basePath, and the path-insertion
 *   variants (RFC 8414 §3.1) are registered at the issuer's pathname — so a
 *   server with basePath `/mcp-server` and Better Auth at `/mcp-server/api/auth`
 *   produces `/.well-known/oauth-authorization-server/mcp-server/api/auth`.
 *
 * - **External** (`{ authURL }`): Better Auth runs on a separate origin. The
 *   SDK only verifies tokens (via JWKS); discovery and the OAuth flow are
 *   proxied/passed through.
 *
 * Learn more: https://better-auth.com/docs/plugins/oauth-provider
 */

import type { Hono as HonoType } from "hono";
import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import type {
  BetterAuthInstance,
  BetterAuthOAuthConfig,
  OAuthProvider,
  UserInfo,
} from "./types.js";

const METADATA_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function metadataResponse(body: Record<string, unknown>): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set("Cache-Control", METADATA_CACHE_CONTROL);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Mirror Better Auth's own baseURL resolution (`utils/url.ts → withPath`):
 * if `baseURL` already has a path, leave it alone; otherwise append
 * `basePath` (default `/api/auth`). This is what Better Auth uses for
 * `ctx.context.baseURL` — the value it signs into tokens as `iss` and
 * substitutes into every advertised endpoint URL — so the SDK must derive
 * the same value or token verification and route mounting silently drift
 * apart.
 */
function resolveBetterAuthBaseURL(
  baseURL: string,
  basePath: string | undefined
): string {
  const trimmedBase = stripTrailingSlash(baseURL);
  let hasPath = false;
  try {
    hasPath = stripTrailingSlash(new URL(trimmedBase).pathname) !== "";
  } catch {
    // Malformed URL — fall through and let `new URL(...)` later surface the
    // error with its native message rather than swallowing it here.
  }
  if (hasPath) return trimmedBase;
  const path = basePath ?? "/api/auth";
  if (!path || path === "/") return trimmedBase;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${stripTrailingSlash(normalized)}`;
}

export class BetterAuthOAuthProvider implements OAuthProvider {
  private config: BetterAuthOAuthConfig;
  private auth: BetterAuthInstance | undefined;
  /** Full issuer URL, e.g. "http://localhost:3000/mcp-server/api/auth". */
  private issuer: string;
  /** JWKS endpoint URL. Always `${issuer}/jwks` for Better Auth. */
  private jwksUrl: string;
  /** Pathname of `issuer` (e.g. "/mcp-server/api/auth"); "" for host-root. */
  private issuerPath: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  // In-process hooks. Wired up in the constructor when `config.auth` is set;
  // left undefined for external mode so `setupOAuthRoutes` falls back to its
  // default upstream-fetch behavior.
  authorizationServerMetadataHandler?: (req: Request) => Promise<Response>;
  openIdConfigurationMetadataHandler?: (req: Request) => Promise<Response>;
  installRoutes?: (rootApp: HonoType, basePath: string) => void;

  constructor(config: BetterAuthOAuthConfig) {
    this.config = config;
    this.auth = config.auth;

    if (config.auth) {
      // In-process: derive the issuer the same way Better Auth resolves
      // `ctx.context.baseURL` internally — see `resolveBetterAuthBaseURL`.
      // The issuer is also where `auth.handler` listens (everything under
      // it is routed to Better Auth), so the user should set
      // `auth.options.baseURL` to the full externally-visible URL where
      // they want Better Auth to live, e.g.
      // `"http://localhost:3000/mcp-server/api/auth"`.
      const baseURL = config.auth.options.baseURL;
      if (!baseURL) {
        throw new Error(
          "Better Auth in-process mode requires `auth.options.baseURL` to be set " +
            "to the externally-visible URL where Better Auth should live, " +
            "e.g. 'http://localhost:3000/mcp-server/api/auth'."
        );
      }
      this.issuer = resolveBetterAuthBaseURL(
        baseURL,
        config.auth.options.basePath
      );
    } else if (config.authURL) {
      // External: trust the configured URL as the issuer.
      this.issuer = stripTrailingSlash(config.authURL);
    } else {
      throw new Error(
        "Better Auth OAuth provider requires either `auth` (in-process mode) " +
          "or `authURL` (external mode)."
      );
    }

    this.jwksUrl = `${this.issuer}/jwks`;
    this.issuerPath = stripTrailingSlash(new URL(this.issuer).pathname);

    // Wire up in-process hooks now that `this.auth`, `this.issuerPath`, etc.
    // are populated. External mode leaves these undefined so the SDK falls
    // back to fetching metadata from the upstream issuer.
    if (this.auth) {
      const auth = this.auth;
      this.authorizationServerMetadataHandler = async (req) =>
        metadataResponse(
          await auth.api.getOAuthServerConfig({
            request: req,
            asResponse: false,
          })
        );
      this.openIdConfigurationMetadataHandler = async (req) =>
        metadataResponse(
          await auth.api.getOpenIdConfig({
            request: req,
            asResponse: false,
          })
        );
      this.installRoutes = (rootApp, _mcpBasePath) => {
        // Mount Better Auth's API handler at the issuer's pathname on the
        // root app. The issuer composes from `auth.options.baseURL` (which
        // the user sets to include MCPServer's basePath) plus Better Auth's
        // own basePath (default `/api/auth`). For the example with
        // `baseURL: "http://localhost:3000/mcp-server"`, that's
        // `/mcp-server/api/auth/*`.
        const handlerPath = this.issuerPath || "";
        rootApp.on(["GET", "POST"], `${handlerPath}/*`, (c) =>
          auth.handler(c.req.raw)
        );
      };
    }
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(this.jwksUrl));
    }
    return this.jwks;
  }

  async verifyToken(
    token: string
  ): Promise<{ payload: Record<string, unknown> }> {
    if (this.config.verifyJwt === false) {
      console.warn("[Better Auth OAuth] ⚠️  JWT verification is disabled");
      console.warn(
        "[Better Auth OAuth]     Enable verifyJwt: true for production"
      );
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = decodeJwt(token);
      return { payload };
    }

    try {
      const result = await jwtVerify(token, this.getJWKS(), {
        issuer: this.issuer,
      });
      return result;
    } catch (error) {
      throw new Error(`Better Auth JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo | Promise<UserInfo> {
    if (this.config.getUserInfo) {
      return this.config.getUserInfo(payload);
    }

    const scope = payload.scope as string | undefined;
    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
      roles: (payload.roles as string[]) || [],
      permissions: (payload.permissions as string[]) || [],
      scopes: scope ? scope.split(" ") : [],
      azp: payload.azp,
      sid: payload.sid,
      email_verified: payload.email_verified,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.issuer}/oauth2/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.issuer}/oauth2/token`;
  }

  getScopesSupported(): string[] {
    return (
      this.config.scopesSupported ?? [
        "openid",
        "profile",
        "email",
        "offline_access",
      ]
    );
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "client_credentials", "refresh_token"];
  }
}
