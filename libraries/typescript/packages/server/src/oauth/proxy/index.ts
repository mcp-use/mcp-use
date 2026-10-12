import type { OAuthMetadata } from "@modelcontextprotocol/server";
import type { Context } from "hono";

import type { OAuthUpstreamToken } from "../../context.js";
import { oauthEnvironmentValue } from "../environment.js";
import { isLocalhost } from "../guards.js";
import {
  oauthCustomProvider,
  type OAuthProvider,
  type OAuthProviderHost,
  type OAuthResourceOptions,
} from "../provider.js";
import {
  configuredClients,
  createCimdFetcher,
  type OAuthProxyClient,
} from "./clients.js";
import type { ConsentPageProps } from "./consent.js";
import {
  deriveKeyring,
  normalizeSecrets,
  randomKeyring,
  type ProxyKeyring,
} from "./crypto.js";
import { ProxyRuntime, type ProxyAuthExtra } from "./runtime.js";
import {
  assertStorage,
  isMemoryStorage,
  memoryStorage,
  SecureStore,
  type OAuthProxyStorage,
} from "./storage.js";
import {
  assertRedirectUpstream,
  type Upstream,
  type UpstreamUser,
} from "./upstream.js";

/** Consent page settings for {@link OAuthProxyOptions.consent}. */
export interface OAuthProxyConsentOptions {
  /**
   * When the consent page appears. `"always"` asks on every sign-in.
   * `"remember"` asks once per browser for each client and HTTPS redirect
   * URI; loopback and custom-scheme redirects still ask every time, because
   * any local program can claim them.
   *
   * @defaultValue `"always"`
   */
  mode?: "always" | "remember";
  /**
   * React component that replaces the built-in consent page. It is rendered
   * on the server with `react-dom/server`, so it needs the `react` and
   * `react-dom` packages. See {@link ConsentPageProps} for the form it must
   * render.
   */
  page?: (props: ConsentPageProps) => unknown;
}

/**
 * Options for {@link oauthProxy}.
 *
 * @typeParam TUser - Application user type exposed as `ctx.auth.user`.
 */
export interface OAuthProxyOptions<TUser> extends OAuthResourceOptions {
  /**
   * The identity provider users sign in with, for example
   * `github({ clientId, clientSecret })`.
   */
  upstream: Upstream;
  /**
   * Secret from which the proxy derives its encryption and cookie keys: a
   * random string of at least 32 characters, for example from
   * `openssl rand -base64 32`. Pass an array to rotate: the first secret
   * encrypts and signs, and the others still decrypt and verify.
   *
   * Defaults to the `MCP_USE_OAUTH_SECRET` environment variable. Required
   * unless the server runs with `listen()` on localhost, where a random key
   * is used and sign-ins end when the process stops.
   */
  secret?: string | readonly string[];
  /**
   * Shared store for clients, sign-ins, grants, and tokens. Required unless
   * the server runs with `listen()` on localhost, where an in-memory store is
   * used. See `mcp-use/oauth/storage` for adapters.
   */
  storage?: OAuthProxyStorage;
  /**
   * The consent page that the proxy shows before it sends the user to the
   * upstream provider. It defends against a malicious client that reuses
   * an earlier upstream approval (the confused-deputy attack). Set `false`
   * only for local development: outside localhost it is refused while
   * dynamic client registration is on.
   *
   * @defaultValue `{ mode: "always" }`
   */
  consent?: false | OAuthProxyConsentOptions;
  /**
   * Client ID metadata document URLs of clients that skip the consent page,
   * for example `"https://claude.ai/oauth/mcp-client-metadata.json"`. Only
   * HTTPS metadata documents qualify, because their owner is verified by the
   * HTTPS host.
   */
  trustedClients?: readonly string[];
  /** Clients configured on the server, with exact redirect URIs. */
  preRegisteredClients?: readonly OAuthProxyClient[];
  /**
   * Accept client ID metadata documents (an HTTPS URL as the `client_id`),
   * the client identification that the MCP specification prefers.
   *
   * @defaultValue `true`
   */
  cimd?: boolean;
  /**
   * Accept dynamic client registration (RFC 7591) at `/oauth/register`, for
   * clients that do not support metadata documents yet. Registered clients
   * are public clients: the proxy never issues a client secret.
   *
   * @defaultValue `true`
   */
  dcr?: boolean;
  /**
   * Lifetime of the proxy's access tokens in seconds. It can be longer than
   * the upstream token's lifetime when the upstream issues refresh tokens:
   * the proxy refreshes the upstream token on the server when needed.
   *
   * @defaultValue `3600`
   */
  accessTokenTtl?: number;
  /**
   * Maps the upstream user to the application user exposed as
   * `ctx.auth.user`. Defaults to the {@link UpstreamUser} itself.
   */
  mapUser?: (user: UpstreamUser) => TUser;
  /**
   * Fetch implementation for upstream and metadata-document requests. When
   * set, the proxy no longer refuses metadata-document hosts that resolve to
   * private addresses; the custom fetch must enforce its own network policy.
   */
  fetch?: typeof globalThis.fetch;
}

/** The provider that {@link oauthProxy} returns. */
export type OAuthProxyProvider<TUser> = OAuthProvider<
  TUser,
  (resource: URL) => OAuthMetadata
>;

/**
 * Creates an OAuth provider that makes the MCP server its own authorization
 * server, in front of an identity provider that does not support dynamic
 * client registration (for example GitHub or Google).
 *
 * MCP clients discover the server's own endpoints, register (or present a
 * client ID metadata document), and sign in through
 * `<base path>/oauth/authorize`. The server shows its consent page, sends
 * the browser to the upstream provider as one OAuth app, exchanges the code
 * on the server, and gives the client its own tokens. The upstream client
 * secret and the upstream tokens never reach the client. Tools read the
 * upstream token with {@link upstreamToken}.
 *
 * Register `https://<your server><base path>/oauth/callback` (for example
 * `https://api.example.com/mcp/oauth/callback`) as the callback URL of the
 * upstream OAuth app.
 *
 * @typeParam TUser - Application user type exposed as `ctx.auth.user`.
 * @param options - Upstream provider, secret, storage, and consent settings.
 * @returns A provider for the `oauth` option of `MCPServer`.
 * @throws A `TypeError` if an option is invalid. When the server mounts, the
 * provider throws if `storage` or `secret` is missing outside a localhost
 * `listen()`.
 *
 * @example
 * ```ts
 * import { MCPServer } from "mcp-use";
 * import { github, oauthProxy, upstreamToken } from "mcp-use/oauth";
 * import { upstashStorage } from "mcp-use/oauth/storage";
 *
 * const server = new MCPServer({
 *   name: "acme",
 *   version: "1.0.0",
 *   oauth: oauthProxy({
 *     upstream: github({
 *       clientId: process.env.GITHUB_CLIENT_ID!,
 *       clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *       scopes: ["read:user"],
 *     }),
 *     secret: process.env.MCP_USE_OAUTH_SECRET,
 *     storage: upstashStorage({
 *       url: process.env.UPSTASH_REDIS_REST_URL!,
 *       token: process.env.UPSTASH_REDIS_REST_TOKEN!,
 *     }),
 *   }),
 * });
 *
 * server.tool({ name: "whoami" }, async (_input, ctx) => {
 *   const response = await fetch("https://api.github.com/user", {
 *     headers: { authorization: `Bearer ${upstreamToken(ctx)}` },
 *   });
 *   return { content: [{ type: "text", text: (await response.json()).login }] };
 * });
 * ```
 */
export function oauthProxy<TUser = UpstreamUser>(
  options: OAuthProxyOptions<TUser>
): OAuthProxyProvider<TUser> {
  if (options === null || typeof options !== "object") {
    throw new TypeError("oauthProxy requires options");
  }
  const upstream = options.upstream;
  if (upstream?.kind === "in-page") {
    throw new TypeError(
      "oauthProxy does not support in-page upstreams yet; use a redirect upstream such as github() or google()"
    );
  }
  if (upstream?.kind !== "redirect") {
    throw new TypeError(
      "oauthProxy upstream must be github(), google(), or upstream({...})"
    );
  }
  assertRedirectUpstream(upstream);

  const configuredSecret =
    options.secret ?? oauthEnvironmentValue("MCP_USE_OAUTH_SECRET");
  const secrets =
    configuredSecret === undefined || configuredSecret === ""
      ? undefined
      : normalizeSecrets(configuredSecret);
  if (options.storage !== undefined) assertStorage(options.storage);
  const consent = normalizeConsent(options.consent);
  const clients = configuredClients(
    options.preRegisteredClients,
    options.trustedClients
  );
  const accessTokenTtl = options.accessTokenTtl ?? 3600;
  if (
    !Number.isInteger(accessTokenTtl) ||
    accessTokenTtl < 60 ||
    accessTokenTtl > 30 * 24 * 60 * 60
  ) {
    throw new TypeError(
      "oauthProxy accessTokenTtl must be an integer from 60 to 2592000 seconds"
    );
  }
  if (options.mapUser !== undefined && typeof options.mapUser !== "function") {
    throw new TypeError("oauthProxy mapUser must be a function");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new TypeError("oauthProxy fetch must be a function");
  }
  const cimd = options.cimd ?? true;
  const dcr = options.dcr ?? true;
  const scopes = [...(options.scopesSupported ?? options.requiredScopes ?? [])];
  const fetchImpl =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const mapUser =
    options.mapUser ?? ((user: UpstreamUser) => user as unknown as TUser);

  let runtime: ProxyRuntime | undefined;
  const runtimeFor = (resource: URL): ProxyRuntime => {
    if (
      runtime === undefined ||
      runtime.config.resource.href !== resource.href
    ) {
      throw new Error(
        "oauthProxy is not mounted: pass it as the oauth option of MCPServer"
      );
    }
    return runtime;
  };

  const setup = (host: OAuthProviderHost<TUser>): void => {
    if (runtime !== undefined) {
      if (runtime.config.resource.href !== host.resourceUrl.href) {
        throw new Error(
          "An oauthProxy provider can serve only one MCP resource"
        );
      }
      registerRoutes(host, runtime, dcr);
      return;
    }
    const local = host.mode === "listen" && isLocalhost(host.resourceUrl);
    let storage = options.storage;
    if (storage === undefined) {
      if (!local) {
        throw new Error(
          "oauthProxy needs storage outside a localhost listen(): pass a shared store from mcp-use/oauth/storage"
        );
      }
      storage = memoryStorage();
    } else if (isMemoryStorage(storage) && !isLocalhost(host.resourceUrl)) {
      throw new Error(
        "oauthProxy memoryStorage() works only on localhost; use a shared store from mcp-use/oauth/storage"
      );
    }
    if (secrets === undefined && !local) {
      throw new Error(
        "oauthProxy needs a secret outside a localhost listen(): set MCP_USE_OAUTH_SECRET or the secret option"
      );
    }
    if (consent === false && dcr && !isLocalhost(host.resourceUrl)) {
      throw new Error(
        "oauthProxy consent: false is allowed only on localhost while dynamic client registration is on"
      );
    }
    if (secrets === undefined) {
      console.warn(
        "[mcp-use] oauthProxy: no secret set; using a random key for this process. " +
          "Sign-ins end when the server restarts. Set MCP_USE_OAUTH_SECRET to keep them."
      );
    }

    let keyring: Promise<ProxyKeyring> | undefined;
    const loadKeyring = (): Promise<ProxyKeyring> => {
      keyring ??=
        secrets === undefined ? randomKeyring() : deriveKeyring(secrets);
      return keyring;
    };
    const store = new SecureStore(storage, loadKeyring);
    runtime = new ProxyRuntime({
      resource: new URL(host.resourceUrl.href),
      basePath: host.basePath,
      store,
      keyring: loadKeyring,
      clients: {
        store,
        configured: clients.byId,
        trustedCimd: clients.trustedCimd,
        cimd,
        dcr,
        fetchCimd: createCimdFetcher(fetchImpl, options.fetch === undefined),
      },
      upstream,
      fetch: fetchImpl,
      scopes,
      accessTokenTtl,
      consent,
      ...(options.resourceName !== undefined && {
        serverName: options.resourceName,
      }),
    });
    registerRoutes(host, runtime, dcr);
  };

  return oauthCustomProvider<TUser, (resource: URL) => OAuthMetadata>({
    ...(options.resource !== undefined && { resource: options.resource }),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: options.requiredScopes,
    }),
    ...(options.scopesSupported !== undefined && {
      scopesSupported: options.scopesSupported,
    }),
    ...(options.resourceName !== undefined && {
      resourceName: options.resourceName,
    }),
    ...(options.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: options.serviceDocumentationUrl,
    }),
    oauthMetadata: (resource) =>
      ProxyRuntime.metadata(resource, resource.pathname, { dcr, cimd, scopes }),
    createTokenVerifier: (resource) => ({
      verifyAccessToken: (token) =>
        runtimeFor(resource).verifyAccessToken(token),
    }),
    mapAuthInfo: (authInfo) => {
      const extra = authInfo.extra as unknown as ProxyAuthExtra;
      return {
        user: mapUser(extra.upstreamUser),
        payload: {
          sub: extra.userKey,
          client_id: authInfo.clientId,
          scope: authInfo.scopes.join(" "),
          provider: upstream.id,
          profile: extra.upstreamUser.profile,
        },
        permissions: [],
      };
    },
    setup,
  });
}

function normalizeConsent(consent: OAuthProxyOptions<unknown>["consent"]):
  | false
  | {
      mode: "always" | "remember";
      page?: (props: ConsentPageProps) => unknown;
    } {
  if (consent === false) return false;
  if (consent === undefined) return { mode: "always" };
  if (consent === null || typeof consent !== "object") {
    throw new TypeError("oauthProxy consent must be false or an object");
  }
  const mode = consent.mode ?? "always";
  if (mode !== "always" && mode !== "remember") {
    throw new TypeError(
      'oauthProxy consent.mode must be "always" or "remember"'
    );
  }
  if (consent.page !== undefined && typeof consent.page !== "function") {
    throw new TypeError("oauthProxy consent.page must be a React component");
  }
  return { mode, ...(consent.page !== undefined && { page: consent.page }) };
}

function registerRoutes<TUser>(
  host: OAuthProviderHost<TUser>,
  runtime: ProxyRuntime,
  dcr: boolean
): void {
  const guard =
    (handler: (c: Context) => Response | Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      try {
        return await handler(c);
      } catch (error) {
        console.error("[mcp-use] oauthProxy request failed:", error);
        c.header("cache-control", "no-store");
        return c.json(
          {
            error: "server_error",
            error_description: "The authorization server failed",
          },
          500
        );
      }
    };
  const { paths } = runtime;
  host.route(
    "GET",
    paths.authorize,
    guard((c) => runtime.authorize(c))
  );
  host.route(
    "POST",
    paths.consent,
    guard((c) => runtime.consent(c))
  );
  host.route(
    "GET",
    paths.callback,
    guard((c) => runtime.callback(c))
  );
  host.route(
    "POST",
    paths.token,
    guard((c) => runtime.token(c))
  );
  host.route("OPTIONS", paths.token, (c) => runtime.preflight(c));
  host.route(
    "POST",
    paths.revoke,
    guard((c) => runtime.revoke(c))
  );
  host.route("OPTIONS", paths.revoke, (c) => runtime.preflight(c));
  if (dcr) {
    host.route(
      "POST",
      paths.register,
      guard((c) => runtime.register(c))
    );
    host.route("OPTIONS", paths.register, (c) => runtime.preflight(c));
  }
}

/**
 * Reads the upstream provider's access token for the signed-in user, for
 * example to call the GitHub API as that user from a tool.
 *
 * Keep the token on the server: do not return it in tool results, views,
 * or `_meta`.
 *
 * @param ctx - The tool, resource, or prompt context.
 * @returns The upstream access token.
 * @throws If the request is not signed in through {@link oauthProxy}.
 */
export function upstreamToken(ctx: {
  auth?: { upstream?: OAuthUpstreamToken } | undefined;
}): string {
  const token = ctx.auth?.upstream?.accessToken;
  if (typeof token !== "string") {
    throw new Error(
      "No upstream token: this request is not signed in through oauthProxy"
    );
  }
  return token;
}

export type { OAuthProxyClient } from "./clients.js";
export type { ConsentPageProps } from "./consent.js";
export { memoryStorage, type OAuthProxyStorage } from "./storage.js";
export { github, google } from "./providers.js";
export type {
  GitHubUpstreamOptions,
  GoogleUpstreamOptions,
} from "./providers.js";
export {
  upstream,
  type InPageProps,
  type InPageUpstream,
  type RedirectUpstream,
  type Upstream,
  type UpstreamOptions,
  type UpstreamTokenSet,
  type UpstreamUser,
} from "./upstream.js";
