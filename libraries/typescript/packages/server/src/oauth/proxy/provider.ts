import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type {
  OAuthExtra,
  OAuthResourceOptions,
  ResourceBoundOAuthProvider,
} from "../provider.js";
import { OAuthAuthorizationCore } from "./authorization-core.js";
import {
  cloneOAuthProxyJsonObject,
  type OAuthProxyJsonObject,
} from "./authorization-records.js";
import {
  createOAuthAuthorizationRoutes,
  type OAuthProxyUpstreamResourceContext,
} from "./authorization-routes.js";
import type { OAuthProxyEncryptionOptions } from "./encryption.js";
import { resolveOAuthProxyStore, type OAuthProxyStore } from "./store.js";
import { UpstreamOAuthClient } from "./upstream-client.js";

const DEFAULT_SCOPES = ["openid", "email", "profile"] as const;
const DEFAULT_AUTHORIZATION_SERVER_PATH = "/oauth";
const SCOPE_PATTERN = /^[\u0021\u0023-\u005B\u005D-\u007E]+$/u;

/** Default user shape extracted from standard verified identity claims. */
export interface OAuthProxyUser {
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
  readonly username?: string;
  readonly picture?: string;
}

/** Successful result returned by an OAuth proxy access-token verifier. */
export interface OAuthProxyVerifiedToken {
  /** Trusted, JSON-serializable identity data persisted with the local grant. */
  readonly payload: OAuthProxyJsonObject;
}

/** Explicit client authentication methods supported at the upstream token endpoint. */
export type OAuthProxyTokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"
  | "none";

interface OAuthProxyCommonOptions<TUser> extends Omit<
  OAuthResourceOptions,
  "scopesSupported"
> {
  /** Upstream provider authorization endpoint. */
  readonly authEndpoint: string | URL;
  /** Upstream provider token endpoint. */
  readonly tokenEndpoint: string | URL;
  /** Expected RFC 9207 upstream authorization-response issuer, when available. */
  readonly issuer?: string | URL;
  /** Require the upstream callback to include the configured RFC 9207 issuer. */
  readonly requireAuthorizationResponseIssuer?: boolean;
  /** Pre-registered upstream OAuth application client identifier. */
  readonly clientId: string;
  /** Scopes grantable to downstream MCP clients. */
  readonly scopes?: readonly string[];
  /** Scopes requested upstream; defaults to {@link scopes}. */
  readonly upstreamScopes?: readonly string[];
  /** Additional non-reserved parameters added to upstream authorization requests. */
  readonly extraAuthorizeParams?: Readonly<Record<string, string>>;
  /** Verifies an upstream access token and returns persistable trusted identity data. */
  readonly verifyToken: (
    providerAccessToken: string
  ) => OAuthProxyVerifiedToken | Promise<OAuthProxyVerifiedToken>;
  /** Maps trusted identity data into the application user exposed on request context. */
  readonly getUserInfo?: (payload: OAuthProxyJsonObject) => TUser;
  /**
   * Verifies an upstream ID token and returns trusted claims. Supplying this
   * hook enables nonce generation and validation for the upstream request.
   */
  readonly verifyIdToken?: (
    idToken: string
  ) =>
    | Readonly<Record<string, unknown>>
    | Promise<Readonly<Record<string, unknown>>>;
  /** Explicit provider-specific resource mapping; the MCP resource is never forwarded. */
  readonly mapUpstreamResource?: (
    context: OAuthProxyUpstreamResourceContext
  ) => string | URL | undefined | Promise<string | URL | undefined>;
  /** OAuth proxy state store. Omission creates a private process-local store. */
  readonly store?: OAuthProxyStore;
  /** SDK-managed encryption for stores that do not encrypt secrets themselves. */
  readonly encryption?: OAuthProxyEncryptionOptions;
  /** Local authorization-server route prefix. Defaults to `/oauth`. */
  readonly authorizationServerPath?: string;
  /** Fetch implementation used for upstream OAuth calls. */
  readonly fetch?: typeof fetch;
  /** Upstream request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum upstream response size in bytes. */
  readonly maxResponseBytes?: number;
  /** Maximum local registration and form body size in bytes. */
  readonly maxBodyBytes?: number;
}

type OAuthProxyClientAuthentication =
  | {
      readonly tokenEndpointAuthMethod: "none";
      readonly clientSecret?: never;
    }
  | {
      readonly tokenEndpointAuthMethod:
        | "client_secret_basic"
        | "client_secret_post";
      readonly clientSecret: string;
    };

/** Options for {@link oauthProxy}. */
export type OAuthProxyOptions<TUser = OAuthProxyUser> =
  OAuthProxyCommonOptions<TUser> & OAuthProxyClientAuthentication;

/** Recognizable v1-compatible name for {@link OAuthProxyOptions}. */
export type OAuthProxyConfig<TUser = OAuthProxyUser> = OAuthProxyOptions<TUser>;

/**
 * Creates an embedded OAuth authorization server that brokers one fixed
 * upstream OAuth application for dynamically registered MCP clients.
 */
export function oauthProxy<TUser = OAuthProxyUser>(
  options: OAuthProxyOptions<TUser>
): ResourceBoundOAuthProvider<TUser> {
  const resolved = resolveOptions(options);
  const { store } = resolveOAuthProxyStore({
    ...(resolved.store === undefined ? {} : { store: resolved.store }),
    ...(resolved.encryption === undefined
      ? {}
      : { encryption: resolved.encryption }),
  });
  const core = new OAuthAuthorizationCore({ store });
  const upstreamClient = new UpstreamOAuthClient({
    authorizationEndpoint: resolved.authEndpoint,
    tokenEndpoint: resolved.tokenEndpoint,
    ...(resolved.issuer === undefined ? {} : { issuer: resolved.issuer }),
    ...(resolved.requireAuthorizationResponseIssuer === undefined
      ? {}
      : {
          requireAuthorizationResponseIssuer:
            resolved.requireAuthorizationResponseIssuer,
        }),
    clientId: resolved.clientId,
    ...(resolved.clientSecret === undefined
      ? {}
      : { clientSecret: resolved.clientSecret }),
    tokenEndpointAuthMethod: resolved.tokenEndpointAuthMethod,
    authorizationParams: resolved.extraAuthorizeParams,
    ...(resolved.fetch === undefined ? {} : { fetch: resolved.fetch }),
    ...(resolved.timeoutMs === undefined
      ? {}
      : { timeoutMs: resolved.timeoutMs }),
    ...(resolved.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: resolved.maxResponseBytes }),
  });

  let boundResource: string | undefined;
  const provider: ResourceBoundOAuthProvider<TUser> = {
    ...(resolved.resource === undefined ? {} : { resource: resolved.resource }),
    ...(resolved.requiredScopes === undefined
      ? {}
      : { requiredScopes: resolved.requiredScopes }),
    scopesSupported: resolved.scopes,
    ...(resolved.resourceName === undefined
      ? {}
      : { resourceName: resolved.resourceName }),
    ...(resolved.serviceDocumentationUrl === undefined
      ? {}
      : { serviceDocumentationUrl: resolved.serviceDocumentationUrl }),
    bind(resource) {
      const canonicalResource = new URL(resource.href);
      if (
        boundResource !== undefined &&
        boundResource !== canonicalResource.href
      ) {
        throw new TypeError(
          "An oauthProxy instance cannot be bound to multiple MCP resources"
        );
      }

      const localIssuer = new URL(
        resolved.authorizationServerPath,
        canonicalResource.origin
      );
      const endpoint = (path: string) =>
        new URL(
          `${resolved.authorizationServerPath}/${path}`,
          localIssuer.origin
        ).href;
      if (
        ["authorize", "callback", "register", "revoke", "token"].some(
          (path) =>
            new URL(endpoint(path)).pathname === canonicalResource.pathname
        )
      ) {
        throw new TypeError(
          "OAuth proxy routes cannot overlap the canonical MCP resource path"
        );
      }
      boundResource = canonicalResource.href;
      const metadata: OAuthMetadata = {
        issuer: localIssuer.href,
        authorization_endpoint: endpoint("authorize"),
        token_endpoint: endpoint("token"),
        registration_endpoint: endpoint("register"),
        revocation_endpoint: endpoint("revoke"),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: [...resolved.scopes],
      };
      const tokenVerifier: OAuthTokenVerifier = {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
          const validated = await core.validateAccessToken(
            token,
            canonicalResource.href
          );
          return {
            token,
            clientId: validated.clientId,
            scopes: [...validated.scopes],
            expiresAt: Math.floor(validated.expiresAt / 1000),
            resource: new URL(validated.resource),
            extra: {
              payload: validated.userPayload,
              providerAccessToken: validated.providerAccessToken,
            },
          };
        },
      };

      return {
        oauthMetadata: metadata,
        tokenVerifier,
        mapAuthInfo: (authInfo) => mapAuthInfo(authInfo, resolved.getUserInfo),
        ...(resolved.requiredScopes === undefined
          ? {}
          : { requiredScopes: resolved.requiredScopes }),
        scopesSupported: resolved.scopes,
        ...(resolved.resourceName === undefined
          ? {}
          : { resourceName: resolved.resourceName }),
        ...(resolved.serviceDocumentationUrl === undefined
          ? {}
          : { serviceDocumentationUrl: resolved.serviceDocumentationUrl }),
        middleware: createOAuthAuthorizationRoutes({
          issuer: localIssuer,
          resource: canonicalResource,
          prefix: resolved.authorizationServerPath,
          scopes: resolved.scopes,
          upstreamScopes: resolved.upstreamScopes,
          core,
          upstreamClient,
          verifyToken: async (providerAccessToken) => {
            const verified = await resolved.verifyToken(providerAccessToken);
            if (
              verified === null ||
              typeof verified !== "object" ||
              !("payload" in verified)
            ) {
              throw new TypeError("verifyToken must return a payload object");
            }
            const payload = cloneOAuthProxyJsonObject(verified.payload);
            validatePermissions(payload);
            if (resolved.getUserInfo(payload) === undefined) {
              throw new TypeError("getUserInfo must return a user");
            }
            return payload;
          },
          ...(resolved.verifyIdToken === undefined
            ? {}
            : {
                verifyIdToken: (idToken: string) =>
                  resolved.verifyIdToken!(idToken),
              }),
          ...(resolved.mapUpstreamResource === undefined
            ? {}
            : { mapUpstreamResource: resolved.mapUpstreamResource }),
          ...(resolved.maxBodyBytes === undefined
            ? {}
            : { maxBodyBytes: resolved.maxBodyBytes }),
        }),
      };
    },
  };
  return provider;
}

interface ResolvedOAuthProxyOptions<TUser> extends Omit<
  OAuthProxyCommonOptions<TUser>,
  | "resource"
  | "requiredScopes"
  | "scopes"
  | "upstreamScopes"
  | "extraAuthorizeParams"
  | "serviceDocumentationUrl"
  | "authorizationServerPath"
  | "getUserInfo"
> {
  readonly resource?: string | URL;
  readonly requiredScopes?: readonly string[];
  readonly scopes: readonly string[];
  readonly upstreamScopes: readonly string[];
  readonly extraAuthorizeParams: Readonly<Record<string, string>>;
  readonly serviceDocumentationUrl?: URL;
  readonly authorizationServerPath: string;
  readonly getUserInfo: (payload: OAuthProxyJsonObject) => TUser;
  readonly tokenEndpointAuthMethod: OAuthProxyTokenEndpointAuthMethod;
  readonly clientSecret?: string;
}

function resolveOptions<TUser>(
  options: OAuthProxyOptions<TUser>
): ResolvedOAuthProxyOptions<TUser> {
  if (options === null || typeof options !== "object") {
    throw new TypeError("oauthProxy options must be an object");
  }
  if (typeof options.verifyToken !== "function") {
    throw new TypeError("oauthProxy verifyToken must be a function");
  }
  if (
    options.getUserInfo !== undefined &&
    typeof options.getUserInfo !== "function"
  ) {
    throw new TypeError("oauthProxy getUserInfo must be a function");
  }
  if (
    options.verifyIdToken !== undefined &&
    typeof options.verifyIdToken !== "function"
  ) {
    throw new TypeError("oauthProxy verifyIdToken must be a function");
  }
  if (
    options.mapUpstreamResource !== undefined &&
    typeof options.mapUpstreamResource !== "function"
  ) {
    throw new TypeError("oauthProxy mapUpstreamResource must be a function");
  }

  const scopes = configuredScopes(options.scopes ?? DEFAULT_SCOPES, "scopes");
  const upstreamScopes = configuredScopes(
    options.upstreamScopes ?? scopes,
    "upstreamScopes"
  );
  const requiredScopes =
    options.requiredScopes === undefined
      ? undefined
      : configuredScopes(options.requiredScopes, "requiredScopes");
  if (requiredScopes?.some((scope) => !scopes.includes(scope))) {
    throw new TypeError("oauthProxy requiredScopes must be grantable scopes");
  }
  const authorizationServerPath = normalizePath(
    options.authorizationServerPath ?? DEFAULT_AUTHORIZATION_SERVER_PATH
  );
  const extraAuthorizeParams = snapshotStringRecord(
    options.extraAuthorizeParams,
    "extraAuthorizeParams"
  );
  const getUserInfo =
    options.getUserInfo ??
    (defaultUserInfo as (payload: OAuthProxyJsonObject) => TUser);
  const resource =
    options.resource instanceof URL
      ? new URL(options.resource.href)
      : options.resource;

  return {
    ...options,
    ...(resource === undefined ? {} : { resource }),
    scopes,
    upstreamScopes,
    ...(requiredScopes === undefined ? {} : { requiredScopes }),
    authorizationServerPath,
    extraAuthorizeParams,
    getUserInfo,
    ...(options.serviceDocumentationUrl === undefined
      ? {}
      : {
          serviceDocumentationUrl: new URL(
            options.serviceDocumentationUrl.href
          ),
        }),
  };
}

function mapAuthInfo<TUser>(
  authInfo: AuthInfo,
  getUserInfo: (payload: OAuthProxyJsonObject) => TUser
): OAuthExtra<TUser> {
  const extra = authInfo.extra;
  if (extra === undefined || typeof extra !== "object") {
    throw new TypeError("OAuth proxy token is missing trusted identity data");
  }
  const payload = cloneOAuthProxyJsonObject(extra["payload"]);
  const providerAccessToken = extra["providerAccessToken"];
  if (
    typeof providerAccessToken !== "string" ||
    providerAccessToken.length === 0
  ) {
    throw new TypeError(
      "OAuth proxy token is missing its provider access token"
    );
  }
  const user = getUserInfo(payload);
  if (user === undefined) {
    throw new TypeError("getUserInfo must return a user");
  }
  return {
    user,
    payload,
    permissions: permissionsFromPayload(payload),
    providerAccessToken,
  };
}

function permissionsFromPayload(payload: OAuthProxyJsonObject): string[] {
  const value = payload["permissions"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Verified OAuth proxy permissions must be strings");
  }
  const permissions: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== "string") {
      throw new TypeError("Verified OAuth proxy permissions must be strings");
    }
    permissions.push(item);
  }
  return permissions;
}

function validatePermissions(payload: OAuthProxyJsonObject): void {
  permissionsFromPayload(payload);
}

function defaultUserInfo(payload: OAuthProxyJsonObject): OAuthProxyUser {
  const id = optionalString(payload, "sub");
  if (id === undefined || id.length === 0) {
    throw new TypeError("Verified OAuth proxy payload must include a subject");
  }
  return {
    id,
    ...optionalProperty("email", optionalString(payload, "email")),
    ...optionalProperty("name", optionalString(payload, "name")),
    ...optionalProperty(
      "username",
      optionalString(payload, "preferred_username") ??
        optionalString(payload, "username")
    ),
    ...optionalProperty("picture", optionalString(payload, "picture")),
  };
}

function optionalString(
  payload: OAuthProxyJsonObject,
  key: string
): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function optionalProperty<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function configuredScopes(
  value: readonly string[],
  name: string
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some(
      (scope) =>
        typeof scope !== "string" ||
        scope.length === 0 ||
        !SCOPE_PATTERN.test(scope)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`oauthProxy ${name} must contain unique OAuth scopes`);
  }
  return Object.freeze((value as readonly string[]).slice());
}

function normalizePath(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/u.test(value) ||
    value === "/"
  ) {
    throw new TypeError(
      "oauthProxy authorizationServerPath must be a non-root absolute path without a trailing slash"
    );
  }
  return value;
}

function snapshotStringRecord(
  value: Readonly<Record<string, string>> | undefined,
  name: string
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`oauthProxy ${name} must be an object of strings`);
  }
  const snapshot: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || typeof entry !== "string") {
      throw new TypeError(
        `oauthProxy ${name} must contain non-empty keys and string values`
      );
    }
    snapshot[key] = entry;
  }
  return Object.freeze(snapshot);
}

export type {
  OAuthProxyJsonObject,
  OAuthProxyJsonValue,
} from "./authorization-records.js";
export type { OAuthProxyUpstreamResourceContext } from "./authorization-routes.js";
