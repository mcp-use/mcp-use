import { isRecord } from "../guards.js";
import { upstream, type RedirectUpstream } from "./upstream.js";

/** Options for {@link github}. */
export interface GitHubUpstreamOptions {
  /** Client ID of the GitHub OAuth app. */
  clientId: string;
  /** Client secret of the GitHub OAuth app. It stays on the server. */
  clientSecret: string;
  /**
   * GitHub OAuth scopes to request, for example `["read:user", "repo"]`.
   *
   * @defaultValue `["read:user"]`
   */
  scopes?: readonly string[];
  /**
   * Base URL of the GitHub web host, for GitHub Enterprise Server or a test
   * emulator.
   *
   * @defaultValue `"https://github.com"`
   */
  baseUrl?: string;
  /**
   * Base URL of the GitHub REST API.
   *
   * @defaultValue `"https://api.github.com"`, or `baseUrl` when `baseUrl` is set
   */
  apiUrl?: string;
}

/**
 * Creates a GitHub upstream for `oauthProxy`.
 *
 * Register an OAuth app at GitHub with the callback URL
 * `https://<your server>/mcp/oauth/callback` (the MCP base path plus
 * `/oauth/callback`). The user's subject is the numeric GitHub user id, and
 * the profile holds `id`, `login`, `name`, `email`, and `avatar_url`.
 *
 * @param options - OAuth app credentials and scopes.
 * @returns An upstream for `oauthProxy`.
 *
 * @example
 * ```ts
 * import { github, oauthProxy } from "mcp-use/oauth";
 *
 * const oauth = oauthProxy({
 *   upstream: github({
 *     clientId: process.env.GITHUB_CLIENT_ID!,
 *     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *     scopes: ["read:user", "repo"],
 *   }),
 * });
 * ```
 */
export function github(options: GitHubUpstreamOptions): RedirectUpstream {
  const baseUrl = trimSlash(options.baseUrl ?? "https://github.com");
  const apiUrl = trimSlash(
    options.apiUrl ??
      (options.baseUrl !== undefined ? baseUrl : "https://api.github.com")
  );
  return upstream({
    id: "github",
    name: "GitHub",
    authorizationEndpoint: `${baseUrl}/login/oauth/authorize`,
    tokenEndpoint: `${baseUrl}/login/oauth/access_token`,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scopes: [...(options.scopes ?? ["read:user"])],
    pkce: true,
    fetchUser: async (tokens, fetch) => {
      const response = await fetch(`${apiUrl}/user`, {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "mcp-use-oauth-proxy",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`GitHub /user returned ${response.status}`);
      }
      const user: unknown = await response.json();
      if (
        !isRecord(user) ||
        (typeof user["id"] !== "number" && typeof user["id"] !== "string")
      ) {
        throw new Error("GitHub /user returned no user id");
      }
      return {
        subject: String(user["id"]),
        profile: pick(user, ["id", "login", "name", "email", "avatar_url"]),
      };
    },
  });
}

/** Options for {@link google}. */
export interface GoogleUpstreamOptions {
  /** Client ID of the Google OAuth client (type "Web application"). */
  clientId: string;
  /** Client secret of the Google OAuth client. It stays on the server. */
  clientSecret: string;
  /**
   * Google scopes to request. `openid` is always added.
   *
   * @defaultValue `["openid", "email", "profile"]`
   */
  scopes?: readonly string[];
  /**
   * Base URL of a Google-compatible test emulator. When set, every endpoint
   * and the issuer move to this URL.
   */
  baseUrl?: string;
}

/**
 * Creates a Google upstream for `oauthProxy`.
 *
 * Add `https://<your server>/mcp/oauth/callback` as an authorized redirect
 * URI of the OAuth client. The proxy requests offline access so it can
 * refresh Google tokens on the server; if Google returns no refresh token
 * and none is stored for the user, it asks Google for consent once more.
 * The user's subject is the OpenID Connect `sub`.
 *
 * @param options - OAuth client credentials and scopes.
 * @returns An upstream for `oauthProxy`.
 */
export function google(options: GoogleUpstreamOptions): RedirectUpstream {
  const base =
    options.baseUrl === undefined ? undefined : trimSlash(options.baseUrl);
  const userinfo =
    base === undefined
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : `${base}/oauth2/v2/userinfo`;
  const scopes = new Set([
    "openid",
    ...(options.scopes ?? ["email", "profile"]),
  ]);
  return upstream({
    id: "google",
    name: "Google",
    issuer: base ?? "https://accounts.google.com",
    authorizationEndpoint:
      base === undefined
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : `${base}/o/oauth2/v2/auth`,
    tokenEndpoint:
      base === undefined
        ? "https://oauth2.googleapis.com/token"
        : `${base}/oauth2/token`,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scopes: [...scopes],
    pkce: true,
    authorizeParams: { access_type: "offline", include_granted_scopes: "true" },
    retryWithoutRefreshToken: { prompt: "consent" },
    fetchUser: async (tokens, fetch) => {
      const response = await fetch(userinfo, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Google userinfo returned ${response.status}`);
      }
      const user: unknown = await response.json();
      if (!isRecord(user) || typeof user["sub"] !== "string") {
        throw new Error("Google userinfo returned no sub");
      }
      return {
        subject: user["sub"],
        profile: pick(user, [
          "sub",
          "email",
          "email_verified",
          "name",
          "picture",
          "hd",
        ]),
      };
    },
  });
}

function pick(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
