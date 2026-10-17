import type {
  AuthInfo as OAuthAuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
  JSONRPCMessage,
} from "@modelcontextprotocol/server";
import type { Context } from "hono";

import type { DefinitionSecuritySchemes, ToolOAuthMode } from "../context.js";
import type {
  McpMiddlewareFnFor,
  McpMiddlewarePattern,
} from "../middleware/mcp-middleware.js";
import type {
  InferPromptInput,
  PromptCallback,
  PromptDefinition,
} from "../prompts.js";
import type {
  InferTemplateParams,
  ResourceCallback,
  ResourceDefinition,
  ResourceTemplateCallback,
  ResourceTemplateDefinition,
} from "../resources.js";
import type {
  InferToolInput,
  InferToolName,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
  ToolRef,
} from "../tools.js";
import {
  assertOAuthMetadata,
  assertSecureHttpUrl,
  parseAbsoluteUrl,
} from "./guards.js";

/** Additional verified identity information exposed by mcp-use callbacks. */
export type OAuthExtra<TUser> = Record<string, unknown> & {
  /** The authenticated application user. */
  user: TUser;
  /** Verified token claims or introspection data. */
  payload: Record<string, unknown>;
  /** Verified permissions granted to the user. */
  permissions: string[];
};

/** Resource-server metadata and bearer-gate configuration. */
export interface OAuthResourceOptions {
  /** Full canonical public MCP endpoint URL. */
  resource?: URL | string;
  /** Endpoint-wide scopes enforced by the SDK bearer gate. */
  requiredScopes?: readonly string[];
  /** Scopes advertised by protected-resource metadata. */
  scopesSupported?: readonly string[];
  /** Human-readable name advertised by protected-resource metadata. */
  resourceName?: string;
  /** Documentation URL advertised by protected-resource metadata. */
  serviceDocumentationUrl?: URL;
}

/**
 * HTTP handler for a provider-owned route registered through
 * {@link OAuthProviderHost.route}.
 *
 * @param context - Hono context for the request. Use it to read the request,
 * the query string, form bodies, and cookies.
 * @returns The response to send.
 */
export type OAuthProviderRouteHandler = (
  context: Context
) => Response | Promise<Response>;

/**
 * Server surface handed to a provider's {@link CustomOAuthProviderOptions.setup}
 * hook while the server mounts.
 *
 * The hook runs once, after the canonical resource is resolved and before the
 * first request is served, so everything registered here participates in the
 * same per-request registry replay as user registrations. Provider-owned
 * tools, resources, resource templates, and prompts go through the same
 * OAuth gate as application items,
 * including a tool's `securitySchemes` on a `mixedAuth` server, and their
 * callbacks receive `ctx.auth` with the provider's user type. The host is
 * only usable while the hook runs.
 *
 * @typeParam TUser - The provider's user type, exposed as `ctx.auth.user`.
 */
export interface OAuthProviderHost<TUser> {
  /** Resolved canonical MCP resource URL (the RFC 8707 `resource`). */
  readonly resourceUrl: URL;
  /** MCP endpoint base path, for example `/mcp`. */
  readonly basePath: string;
  /**
   * Whether the server was constructed with `mixedAuth: true`, so signed-out
   * clients can connect, list, and call `noauth` tools. A provider that
   * needs anonymous discovery can throw from `setup` when this is `false`.
   */
  readonly mixedAuth: boolean;
  /**
   * How the server mounted: `"listen"` when `server.listen()` serves it, and
   * `"handler"` when a platform calls `server.fetch` (or a framework adapter)
   * instead. A provider can use it to allow development-only defaults on a
   * local listener.
   */
  readonly mode: "listen" | "handler";
  /**
   * Address `server.listen()` bound to, for example `127.0.0.1` or
   * `0.0.0.0`. `undefined` in `"handler"` mode, where the server cannot see
   * how the platform or framework serves it. A provider can use it to allow
   * a development-only setting only when the listener is reachable from
   * this machine alone.
   */
  readonly listenHost?: string | undefined;
  /**
   * Registers a provider-owned HTTP route, such as an authorization
   * endpoint. The server mounts it ahead of the OAuth gate and of the
   * application's own routes, so it is public and the application cannot
   * shadow it.
   *
   * These routes also skip the server's `Origin` validation
   * (`allowedOrigins`), because MCP clients call OAuth endpoints
   * cross-origin and the provider's own pages post back to them. The handler
   * must validate each request itself, for example with a CSRF token on a
   * cookie-authenticated `POST`.
   *
   * @param method - HTTP method to match.
   * @param path - Absolute pathname. It must sit under the MCP base path, for
   * example `/mcp/oauth/token`.
   * @param handler - Handler that produces the response.
   * @throws If the path is not under the MCP base path, or another provider
   * route already uses the same method and path.
   */
  route(
    method: "GET" | "POST" | "OPTIONS",
    path: string,
    handler: OAuthProviderRouteHandler
  ): void;
  /**
   * Registers MCP middleware using the same `mcp:` patterns accepted by
   * `server.use()`.
   */
  use<P extends McpMiddlewarePattern>(
    pattern: P,
    handler: McpMiddlewareFnFor<P>
  ): void;
  /**
   * Registers a provider-owned tool, like `server.tool()`: `ctx.auth` is
   * required in the callback unless `definition.securitySchemes` includes
   * `noauth`.
   *
   * @throws If a tool with the same name is already registered, or when
   * `definition.securitySchemes` is invalid for this server.
   */
  tool<const T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<
      InferToolInput<T>,
      InferToolOutput<T>,
      TUser,
      ToolOAuthMode<TUser, DefinitionSecuritySchemes<T>>
    >
  ): ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>>;
  /**
   * Registers a provider-owned static resource, like `server.resource()`.
   * Resources always require sign-in, including on a `mixedAuth` server.
   *
   * @throws If a resource with the same name is already registered.
   */
  resource<T extends ResourceDefinition>(
    definition: T,
    callback: ResourceCallback<TUser, true>
  ): void;
  /**
   * Registers a provider-owned parameterized resource, like
   * `server.resourceTemplate()`. Resource templates always require sign-in,
   * including on a `mixedAuth` server.
   *
   * @throws If a resource template with the same name is already registered.
   */
  resourceTemplate<const TUriTemplate extends string>(
    definition: ResourceTemplateDefinition<TUriTemplate>,
    callback: ResourceTemplateCallback<
      InferTemplateParams<{ uriTemplate: TUriTemplate }>,
      TUser,
      true
    >
  ): void;
  /**
   * Registers a provider-owned prompt, like `server.prompt()`. Prompts always
   * require sign-in, including on a `mixedAuth` server.
   *
   * @throws If a prompt with the same name is already registered.
   */
  prompt<T extends PromptDefinition>(
    definition: T,
    callback: PromptCallback<InferPromptInput<T>, TUser, true>
  ): void;
  /**
   * Every tool registered so far, application and provider-owned, in
   * registration order. Providers use it to validate the application's
   * tools, for example to refuse a destructive tool that lacks a required
   * `_meta` tag, or one whose `securitySchemes` accepts `noauth`.
   */
  listTools(): readonly Readonly<ToolDefinition>[];
  /**
   * Rewrites the instructions text advertised to clients. The transform
   * receives the current text, including earlier transforms, and returns
   * the text to advertise instead. The caller's config is not mutated.
   */
  instructions(transform: (current: string | undefined) => string): void;
}

/**
 * Authorization-server metadata, or a function that computes it from the
 * resolved canonical MCP resource URL.
 */
export type OAuthMetadataSource =
  | OAuthMetadata
  | ((resource: URL) => OAuthMetadata);

/**
 * Result of a provider-owned request-admission check.
 *
 * Return a Response to refuse or otherwise handle the request. To admit it,
 * return the bearer token associated with the verified SDK authentication data.
 * Return `{ type: "defer" }` to use the built-in bearer verifier and its
 * signed-out policy, including anonymous access permitted by `mixedAuth`.
 */
export type OAuthAdmissionResult =
  | Response
  | { type: "defer" }
  | { bearer: string; authInfo: OAuthAuthInfo };

/**
 * Authenticates an MCP request before mcp-use runs its built-in OAuth gate.
 * Messages are supplied as an array for both single requests and JSON-RPC
 * batches; malformed or empty bodies produce an empty array.
 */
export type OAuthAdmissionHook = (
  request: Request,
  messages: JSONRPCMessage[]
) => Promise<OAuthAdmissionResult>;

/**
 * Options for {@link oauthCustomProvider}.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
 * @typeParam TMetadata - Static metadata (the default), or a metadata function.
 */
export interface CustomOAuthProviderOptions<
  TUser,
  TMetadata extends OAuthMetadataSource = OAuthMetadata,
> extends OAuthResourceOptions {
  /** Creates a verifier bound to the resolved canonical MCP resource. */
  createTokenVerifier: (resource: URL) => OAuthTokenVerifier;
  /**
   * RFC 8414 metadata for the authorization server. Pass a function when the
   * metadata depends on the canonical MCP resource, for example when the
   * server is its own authorization server. The server calls the function
   * once at mount time, with the resolved resource URL, and requires an
   * `https` issuer (or `http` on localhost) in the result.
   */
  oauthMetadata: TMetadata;
  /** Maps verified SDK auth information into mcp-use callback identity data. */
  mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
  /**
   * Optional request-admission hook for OAuth adapters that authenticate
   * requests outside the standard bearer verifier.
   *
   * It runs for MCP endpoint requests served through both `server.fetch` and
   * `server.listen()`. Return a Response to short-circuit the request, return
   * the presented bearer token and verified AuthInfo to admit it, or return
   * `{ type: "defer" }` to use the built-in bearer verifier. Deferring also
   * preserves the built-in mixed-auth policy for requests without credentials.
   * mcp-use still enforces the provider's required scopes and tool security
   * schemes against the returned AuthInfo.
   */
  admit?: OAuthAdmissionHook;
  /**
   * Optional hook invoked once while the server mounts. Providers use it to
   * install MCP middleware, provider-owned tools, resources, and prompts, or
   * instructions text that the authorization model requires. See
   * {@link OAuthProviderHost}.
   *
   * The hook must be synchronous. If it throws or returns a promise, the
   * server never mounts: every request and `listen()` rethrows that error.
   */
  setup?: (host: OAuthProviderHost<TUser>) => void;
}

/**
 * OAuth resource-server provider accepted by the mcp-use server constructor.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
 * @typeParam TMetadata - Static metadata (the default), or a metadata function.
 */
export type OAuthProvider<
  TUser,
  TMetadata extends OAuthMetadataSource = OAuthMetadata,
> = CustomOAuthProviderOptions<TUser, TMetadata>;

/**
 * Creates an OAuth provider backed by an external authorization server.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
 * @typeParam TMetadata - Static metadata (the default), or a metadata function.
 * @param options - Token verification, discovery metadata, and identity mapping.
 * @returns A provider for an OAuth-enabled MCP server.
 * @throws A `TypeError` if provider metadata or resource settings are invalid.
 *
 * @example
 * ```ts
 * import { oauthCustomProvider } from "mcp-use/oauth";
 *
 * const oauth = oauthCustomProvider({
 *   createTokenVerifier: (resource) => tokenVerifierFor(resource),
 *   oauthMetadata,
 *   mapAuthInfo: (authInfo) => ({
 *     user: { id: authInfo.clientId },
 *     payload: {},
 *     permissions: [],
 *   }),
 * });
 * ```
 */
export function oauthCustomProvider<
  TUser,
  TMetadata extends OAuthMetadataSource = OAuthMetadata,
>(
  options: CustomOAuthProviderOptions<TUser, TMetadata>
): OAuthProvider<TUser, TMetadata> {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.createTokenVerifier !== "function" ||
    typeof options.mapAuthInfo !== "function"
  ) {
    throw new TypeError(
      "oauthCustomProvider requires createTokenVerifier, oauthMetadata, and mapAuthInfo"
    );
  }

  if (options.admit !== undefined && typeof options.admit !== "function") {
    throw new TypeError("admit must be a function when provided");
  }

  if (options.setup !== undefined && typeof options.setup !== "function") {
    throw new TypeError("setup must be a function when provided");
  }

  if (typeof options.oauthMetadata !== "function") {
    assertOAuthMetadata(options.oauthMetadata);
  }
  if (options.resource !== undefined) {
    assertResourceUrl(options.resource);
  }
  assertStringArray(options.requiredScopes, "requiredScopes");
  assertStringArray(options.scopesSupported, "scopesSupported");
  if (
    options.resourceName !== undefined &&
    (typeof options.resourceName !== "string" ||
      options.resourceName.trim().length === 0)
  ) {
    throw new TypeError("resourceName must be a non-empty string");
  }
  if (options.serviceDocumentationUrl !== undefined) {
    if (!(options.serviceDocumentationUrl instanceof URL)) {
      throw new TypeError("serviceDocumentationUrl must be a URL");
    }
    assertSecureHttpUrl(
      options.serviceDocumentationUrl,
      "serviceDocumentationUrl"
    );
  }

  const provider: OAuthProvider<TUser, TMetadata> = {
    createTokenVerifier: options.createTokenVerifier,
    oauthMetadata: options.oauthMetadata,
    mapAuthInfo: options.mapAuthInfo,
    ...(options.admit !== undefined && { admit: options.admit }),
    ...(options.setup !== undefined && { setup: options.setup }),
    ...(options.resource !== undefined && { resource: options.resource }),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: [...options.requiredScopes],
    }),
    ...(options.scopesSupported !== undefined && {
      scopesSupported: [...options.scopesSupported],
    }),
    ...(options.resourceName !== undefined && {
      resourceName: options.resourceName,
    }),
    ...(options.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: options.serviceDocumentationUrl,
    }),
  };
  return provider;
}

function assertResourceUrl(resource: URL | string): void {
  assertSecureHttpUrl(parseAbsoluteUrl(resource, "resource"), "resource");
}

function assertStringArray(
  value: readonly string[] | undefined,
  name: string
): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
  ) {
    throw new TypeError(`${name} must be an array of strings`);
  }
}
