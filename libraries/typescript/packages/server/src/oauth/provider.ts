import type {
  AuthInfo as OAuthAuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

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
import { assertSecureHttpUrl, parseAbsoluteUrl } from "./internal.js";

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

/** Options for {@link oauthCustomProvider}. */
export interface CustomOAuthProviderOptions<
  TUser,
> extends OAuthResourceOptions {
  /** Creates a verifier bound to the resolved canonical MCP resource. */
  createTokenVerifier: (resource: URL) => OAuthTokenVerifier;
  /** RFC 8414 metadata for the external authorization server. */
  oauthMetadata: OAuthMetadata;
  /** Maps verified SDK auth information into mcp-use callback identity data. */
  mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
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

/** OAuth resource-server provider accepted by the mcp-use server constructor. */
export type OAuthProvider<TUser> = CustomOAuthProviderOptions<TUser>;

/**
 * Creates an OAuth provider backed by an external authorization server.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
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
export function oauthCustomProvider<TUser>(
  options: CustomOAuthProviderOptions<TUser>
): OAuthProvider<TUser> {
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

  if (options.setup !== undefined && typeof options.setup !== "function") {
    throw new TypeError("setup must be a function when provided");
  }

  assertOAuthMetadata(options.oauthMetadata);
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

  const provider: OAuthProvider<TUser> = {
    createTokenVerifier: options.createTokenVerifier,
    oauthMetadata: options.oauthMetadata,
    mapAuthInfo: options.mapAuthInfo,
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

function assertOAuthMetadata(
  metadata: unknown
): asserts metadata is OAuthMetadata {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("issuer" in metadata) ||
    typeof metadata.issuer !== "string"
  ) {
    throw new TypeError("oauthMetadata must include a string issuer");
  }
  assertSecureHttpUrl(
    parseAbsoluteUrl(metadata.issuer, "oauthMetadata.issuer"),
    "oauthMetadata.issuer"
  );
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
