import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer as SdkMcpServer,
  ResourceTemplate,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  isJSONRPCRequest,
  isInputRequiredResult,
  type ClientCapabilities,
  type McpHttpHandler,
  type McpRequestContext,
  type PromptCallback as SdkPromptCallback,
  type ServerEventBus,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { createServer as createNodeHttpServer } from "#mcp-use-node-http";
import type { Server as NodeHttpServer } from "node:http";
import { Hono, type Env, type MiddlewareHandler } from "hono";

import {
  createFaviconHandler,
  hasLocalBrandingAsset,
  normalizeServerBranding,
  resolveImplementationIcons,
  type ServerBranding,
} from "./branding.js";
import { assertServerConfig, type ServerConfig } from "./config.js";
import { resolveListenHost, resolveListenPort } from "./listen-address.js";
import { toNodeHandler } from "./node-bridge.js";
import {
  toAuthenticatedRequestContext,
  toRequestContext,
  type RequestContext,
} from "./context.js";
import { toPromptResult, toResourceResult } from "./response-conversion.js";
import {
  getRequestBag,
  hostValidationMiddleware,
  isHtmlNavigationRequest,
  jsonBodyMiddleware,
  originValidationMiddleware,
  type FetchHandler,
  type FetchMiddleware,
} from "./fetch-app.js";
import { corsFetchMiddleware, isGlobalCorsEnabled } from "./middleware/cors.js";
import {
  createMcpEventListenerEntry,
  createMcpMiddlewareEntry,
  matchesPattern,
  runMcpOperation,
  withMcpMiddlewareParams,
  type McpEventListenerFnFor,
  type McpEventPattern,
  type McpEventListenerEntry,
  type McpMiddlewareEntry,
  type McpMiddlewareFnFor,
  type McpMiddlewareMethod,
  type McpMiddlewarePattern,
  type McpMiddlewareResult,
  type MiddlewareContext,
} from "./middleware/mcp-middleware.js";
import { requestLogger } from "./logging.js";
import { createMcpMount } from "./mount-mcp.js";
import { normalizeCompletions } from "./resource-completion.js";
import { registerOpenAPITools } from "./openapi/index.js";
import type { FromOpenAPIOptions } from "./openapi/types.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "./oauth/index.js";
import { authInfoFromRequest, oauthMetadata } from "./oauth/adapters.js";
import {
  getOAuthProviderOptions,
  resolveConfiguredOAuthResource,
  resolveLocalOAuthResource,
  wrapOAuthTokenVerifier,
} from "./oauth/internal.js";
import type {
  InferPromptInput,
  PromptCallback,
  PromptDefinition,
} from "./prompts.js";
import type {
  InferTemplateParams,
  ResourceCallback,
  ResourceDefinition,
  ResourceTemplateCallback,
  ResourceTemplateDefinition,
  TemplateVariableValue,
} from "./resources.js";
import type {
  ProxyConnection,
  ProxyMountHost,
  ProxyServerConfig,
} from "./mcp-proxy.js";
import type {
  InferToolInput,
  InferToolName,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
  ToolRef,
  ToolViewConfig,
} from "./tools.js";
import { resolveToolInputSchema } from "./tools.js";
import { isUsageDisabled, recordUsage } from "./usage.js";
import { supportsViews } from "./views/capabilities.js";
import type { ViewResourceFacts } from "./views/types.js";
import {
  createViewPublicHandler,
  createViewAssetsHandler,
  registerViews,
  resolveAssetsBase,
  synthesizeViewDocument,
  viewResourceConfig,
  viewResourceUri,
  buildResourceUiMeta,
  buildToolResultUiMeta,
  buildToolUiMeta,
  type BuildResourceUiMetaOptions,
  type ViewManifestEntry,
  type ViewsManifest,
} from "./views/index.js";

/*
 * Registry entries hold callbacks type-erased to their widest signature; the
 * registration methods cast the schema-narrowed callback down at `.set()`.
 * Safe because the SDK validates params against the definition's schema
 * before any callback runs.
 */
type HasOAuth<TUser> = [TUser] extends [never] ? false : true;

interface ClientUsage {
  client_name: string;
  client_version: string;
  protocol_era: "modern" | "legacy";
  protocol_version: string;
  connection_mode: "stateless_request" | "legacy_session";
  sampling_capability: boolean;
  elicitation_capability: boolean;
  roots_capability: boolean;
  extensions_capability: boolean;
  views_capability: boolean;
  capability_count: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function productId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 64 &&
    ![...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
    ? normalized
    : fallback;
}

function clientUsageFromBody(body: unknown): ClientUsage | undefined {
  if (!isJSONRPCRequest(body)) return undefined;
  const params = record(body.params);
  if (body.method === "initialize") {
    const info = record(params?.["clientInfo"]);
    const capabilities = record(params?.["capabilities"]) ?? {};
    return clientUsage(
      info,
      capabilities,
      params?.["protocolVersion"],
      "legacy"
    );
  }
  const meta = record(params?.["_meta"]);
  const info = record(meta?.[CLIENT_INFO_META_KEY]);
  const capabilities = record(meta?.[CLIENT_CAPABILITIES_META_KEY]);
  if (info === undefined || capabilities === undefined) return undefined;
  return clientUsage(
    info,
    capabilities,
    meta?.[PROTOCOL_VERSION_META_KEY],
    "modern"
  );
}

function clientUsage(
  info: Record<string, unknown> | undefined,
  capabilities: Record<string, unknown>,
  protocolVersion: unknown,
  era: ClientUsage["protocol_era"]
): ClientUsage {
  const typedCapabilities = capabilities as ClientCapabilities;
  return {
    client_name: productId(info?.["name"], "other"),
    client_version: productId(info?.["version"], "unknown"),
    protocol_era: era,
    protocol_version: productId(protocolVersion, "unknown"),
    connection_mode: era === "modern" ? "stateless_request" : "legacy_session",
    sampling_capability: Object.hasOwn(capabilities, "sampling"),
    elicitation_capability: Object.hasOwn(capabilities, "elicitation"),
    roots_capability: Object.hasOwn(capabilities, "roots"),
    extensions_capability: Object.hasOwn(capabilities, "extensions"),
    views_capability: supportsViews(typedCapabilities),
    capability_count: Object.keys(capabilities).length,
  };
}

/** Type-erased registry entry replayed when a per-request SDK server is built. */
interface ToolEntry<TUser, TEnv extends Env> {
  /** Declarative tool metadata and schemas supplied at registration time. */
  definition: ToolDefinition;
  /** Tool callback widened for heterogeneous storage in the registry. */
  callback: ToolCallback<
    Record<string, unknown>,
    never,
    TUser,
    HasOAuth<TUser>,
    TEnv
  >;
}

/** Static resource definition and callback retained for per-request replay. */
interface ResourceEntry<TUser, TEnv extends Env> {
  /** Declarative resource metadata supplied at registration time. */
  definition: ResourceDefinition;
  /** Callback invoked when the registered resource URI is read. */
  callback: ResourceCallback<TUser, HasOAuth<TUser>, TEnv>;
}

/** Parameterized resource definition and type-erased callback registry entry. */
interface ResourceTemplateEntry<TUser, TEnv extends Env> {
  /** Declarative template metadata, including its URI template. */
  definition: ResourceTemplateDefinition;
  /** Template callback widened to store every inferred variable shape. */
  callback: ResourceTemplateCallback<
    Record<string, TemplateVariableValue>,
    TUser,
    HasOAuth<TUser>,
    TEnv
  >;
  /** SDK callback map normalized once at author-time registration. */
  complete?: ReturnType<typeof normalizeCompletions>;
}

/** Prompt definition and type-erased callback retained for request-time replay. */
interface PromptEntry<TUser, TEnv extends Env> {
  /** Declarative prompt metadata and optional argument schema. */
  definition: PromptDefinition;
  /** Prompt callback widened to store every inferred argument shape. */
  callback: PromptCallback<
    Record<string, unknown>,
    TUser,
    HasOAuth<TUser>,
    TEnv
  >;
}

/** Node HTTP listener returned by `listen()`. */
interface NodeHttpListener {
  close(callback?: (error?: Error) => void): void;
  once(event: "error", listener: (error: unknown) => void): void;
  listen(port: number, hostname: string, callback?: () => void): NodeHttpServer;
  address(): { port: number } | string | null;
}

/** Options accepted by {@link MCPServer.listen}. */
export interface ListenOptions {
  /** Explicit bind host; takes precedence over `HOST` and configured `host`. */
  host?: string;
}

function omitRootSchemaDialect<T>(schema: T): T {
  if (
    typeof schema !== "object" ||
    schema === null ||
    Array.isArray(schema) ||
    !("$schema" in schema)
  ) {
    return schema;
  }

  const emittedSchema = { ...schema } as T & Record<string, unknown>;
  delete emittedSchema["$schema"];
  return emittedSchema;
}

function omitToolSchemaDialects(
  tools: McpMiddlewareResult<"tools/list">
): McpMiddlewareResult<"tools/list"> {
  return tools.map((tool) => ({
    ...tool,
    inputSchema: omitRootSchemaDialect(tool.inputSchema),
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: omitRootSchemaDialect(tool.outputSchema) }),
  }));
}

function registerFetchMiddleware<TEnv extends Env>(
  app: Hono<TEnv>,
  middleware: FetchMiddleware
): void {
  app.use("*", async (context, next) => {
    const response = await middleware(context.req.raw, async () => {
      await next();
      return context.res;
    });
    context.res = response;
    return response;
  });
}

/**
 * MCP server with declarative tool/resource/prompt registration, served
 * statelessly over a composed fetch handler.
 *
 * Registrations are stored in a registry; a fresh SDK `McpServer` is built
 * from it for every HTTP request (the stateless 2026-07-28 model), so
 * definition-time work must stay cheap — put pools and caches at module
 * scope, not inside callbacks' setup.
 *
 * @example
 * ```ts
 * const server = new MCPServer({ name: "my-server", version: "1.0.0" });
 * server.tool(
 *   { name: "add", inputSchema: z.object({ a: z.number(), b: z.number() }) },
 *   async ({ a, b }) => ({
 *     content: [{ type: "text", text: String(a + b) }],
 *   })
 * );
 * await server.listen(3000);
 * ```
 */
export class MCPServer<TUser = never, TEnv extends Env = Env> {
  readonly #config: ServerConfig<TUser>;
  readonly #branding: ReturnType<typeof normalizeServerBranding>;
  readonly #tools = new Map<string, ToolEntry<TUser, TEnv>>();
  readonly #resources = new Map<string, ResourceEntry<TUser, TEnv>>();
  readonly #resourceTemplates = new Map<
    string,
    ResourceTemplateEntry<TUser, TEnv>
  >();
  readonly #prompts = new Map<string, PromptEntry<TUser, TEnv>>();
  readonly #views = new Map<string, ViewManifestEntry>();
  /**
   * One-to-one tool→view bindings. Each view name maps to the single tool
   * that bound it; that tool's `view:` config is the sole source of
   * resource facts for the primed view resource.
   */
  readonly #viewBindings = new Map<
    string,
    {
      toolName: string;
      config: ToolViewConfig;
    }
  >();
  #viewsPrimed = false;
  /** When true, resource CSP emission includes the HMR websocket origin. */
  #viewsDevMode = false;
  /** Project root for filesystem-backed view bundle and public routes. */
  #viewsProjectRoot = process.cwd();

  #fetchHandler: FetchHandler | undefined;
  #httpApp: Hono<TEnv> | undefined;
  #handler: McpHttpHandler | undefined;
  #eventBus: ServerEventBus | undefined;
  #httpServer: NodeHttpListener | undefined;
  #oauthResource: URL | undefined;
  #oauthResourceResolved = false;
  #oauthResourceConfigurationAbsent = false;
  /** Whether the mounted app validates Host headers (fixed at first mount). */
  #hostValidated = false;
  readonly #mcpMiddlewares: McpMiddlewareEntry[] = [];
  readonly #mcpEventListeners: McpEventListenerEntry[] = [];
  // Keep construction import-safe for Workers. The scope is only needed when
  // request-time telemetry is recorded.
  #usageScope: string | undefined;
  readonly #openApiTools = new Set<string>();
  readonly #proxiedTools = new Set<string>();
  readonly #proxiedResources = new Set<string>();
  readonly #proxiedPrompts = new Set<string>();
  #httpMiddlewareCount = 0;
  #proxyServersConfigured = 0;
  #proxyServersConnected = 0;
  #proxyToolsDiscovered = 0;
  #proxyResourcesDiscovered = 0;
  #proxyPromptsDiscovered = 0;
  /** Client instances created by {@link MCPServer.proxy} and owned by this server. */
  readonly #proxyOwners: Array<{ close(): Promise<void> }> = [];
  /** Proxy registrations that {@link close} must let finish before cleanup. */
  readonly #proxyOperations = new Set<Promise<void>>();
  /** Whether terminal shutdown has begun. */
  #closed = false;

  /** Hono application that owns HTTP middleware and routes. */
  readonly app: Hono<TEnv>;

  /** Register a typed `GET` route on {@link MCPServer.app}. */
  readonly get: Hono<TEnv>["get"];

  /** Register a typed `POST` route on {@link MCPServer.app}. */
  readonly post: Hono<TEnv>["post"];

  /** Register a typed `PUT` route on {@link MCPServer.app}. */
  readonly put: Hono<TEnv>["put"];

  /** Register a typed `PATCH` route on {@link MCPServer.app}. */
  readonly patch: Hono<TEnv>["patch"];

  /** Register a typed `DELETE` route on {@link MCPServer.app}. */
  readonly delete: Hono<TEnv>["delete"];

  /** Register a typed route for every HTTP method on {@link MCPServer.app}. */
  readonly all: Hono<TEnv>["all"];

  /**
   * Canonical Web-standard handler for edge runtimes and framework mounting.
   *
   * @example
   * ```ts
   * export default server;
   * // or: export const POST = server.fetch;
   * ```
   */
  readonly fetch: (
    ...args: Parameters<Hono<TEnv>["fetch"]>
  ) => Promise<Response>;

  /**
   * Create an MCP server from a parsed, bundled OpenAPI document.
   *
   * Each included OpenAPI operation becomes a tool that validates its input,
   * calls the matching upstream HTTP endpoint, and returns the response using
   * the SDK's raw tool-result shape. External `$ref` values are not fetched;
   * bundle the document before passing it in.
   *
   * @param options - OpenAPI document, operation filters, upstream URL, and
   * request authentication options.
   * @returns An unauthenticated MCP server populated with generated tools.
   *
   * @example
   * ```ts
   * const spec = await fetch("https://api.example.com/openapi.json")
   *   .then((response) => response.json());
   * const server = MCPServer.fromOpenAPI({ spec });
   * await server.listen(3000);
   * ```
   */
  static fromOpenAPI(options: FromOpenAPIOptions): MCPServer {
    const server = new MCPServer({
      name: options.name ?? options.spec.info.title,
      version: options.version ?? options.spec.info.version ?? "1.0.0",
    });
    registerOpenAPITools(server, options);
    for (const name of server.#tools.keys()) server.#openApiTools.add(name);
    return server;
  }

  /**
   * Create a server. `config.name` and `config.version` identify the server
   * to clients during initialization. `config.basePath` (default `"/mcp"`)
   * is both the MCP route and the path of the OAuth protected-resource
   * identity, so any explicit OAuth resource URL must use that exact path.
   * Nothing binds or listens until {@link MCPServer.listen} or
   * the first request reaches {@link MCPServer.fetch}.
   */
  constructor(config: ServerConfig<TUser>) {
    assertServerConfig(config);
    this.#config = config;
    this.#branding = normalizeServerBranding(config);
    this.app = new Hono<TEnv>();
    this.app.use("*", async (context, next) => {
      getRequestBag(context.req.raw).honoContext = context as never;
      await next();
    });
    this.get = this.app.get.bind(this.app) as Hono<TEnv>["get"];
    this.post = this.app.post.bind(this.app) as Hono<TEnv>["post"];
    this.put = this.app.put.bind(this.app) as Hono<TEnv>["put"];
    this.patch = this.app.patch.bind(this.app) as Hono<TEnv>["patch"];
    this.delete = this.app.delete.bind(this.app) as Hono<TEnv>["delete"];
    this.all = this.app.all.bind(this.app) as Hono<TEnv>["all"];
    this.fetch = async (request, env, executionCtx) => {
      this.#ensureMounted("handler");
      return this.#httpApp!.fetch(request, env, executionCtx);
    };
    if (config.oauth !== undefined) {
      const mcpUrl =
        typeof process === "undefined" ? undefined : process.env["MCP_URL"];
      const resource = resolveConfiguredOAuthResource({
        provider: config.oauth,
        basePath: this.#basePath(),
        ...(mcpUrl !== undefined && { mcpUrl }),
      });
      this.#oauthResource = resource;
      this.#oauthResourceResolved = resource !== undefined;
      this.#oauthResourceConfigurationAbsent = resource === undefined;
    }
  }

  /**
   * The URL path prefix the MCP endpoint is mounted at.
   *
   * Reflects `config.basePath` (default `"/mcp"`). Exposed so tooling that
   * imports the entry module — `mcp-use dev`'s startup log, for example —
   * can build endpoint and development-tool URLs without assuming the default.
   */
  get basePath(): string {
    return this.#basePath();
  }

  /** Configured bind host, before CLI and environment overrides. */
  get host(): string | undefined {
    return this.#config.host;
  }

  /** Configured bind port, before CLI and environment overrides. */
  get port(): number | undefined {
    return this.#config.port;
  }

  /**
   * Immutable normalized branding shared by MCP identity and browser pages.
   *
   * `favicon` is the final source after explicit-favicon and icon-selection
   * precedence. Landing-page integrations can use this accessor and link to
   * the server's root-level `/favicon.ico` route without reading private
   * configuration or depending on the landing/view layers.
   *
   * @example
   * ```ts
   * if (server.branding.favicon) {
   *   console.log("Browser favicon: /favicon.ico");
   * }
   * ```
   */
  get branding(): ServerBranding {
    return this.#branding;
  }

  /** @deprecated Use {@link MCPServer.fetch} directly. */
  getHandler(): typeof this.fetch {
    return this.fetch;
  }

  /**
   * Register a tool. Input is validated against `inputSchema` before the callback
   * runs; results carrying `structuredContent` are type-checked against
   * `outputSchema` at the callback's return position.
   *
   * Assign static registrations to exported constants so `mcp-env.d.ts` can
   * expose their {@link ToolRef} types to views:
   * `export const search = server.tool(...)`.
   *
   * @returns A {@link ToolRef} carrying the tool name and phantom types for
   * inference-based view typing.
   */
  tool<const T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<
      InferToolInput<T>,
      InferToolOutput<T>,
      TUser,
      HasOAuth<TUser>,
      TEnv
    >
  ): ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>> {
    this.#assertNotStarted("tool", definition.name);
    this.#validateToolViewBinding(definition);
    this.#openApiTools.delete(definition.name);
    this.#proxiedTools.delete(definition.name);
    this.#tools.set(definition.name, {
      definition,
      callback: callback as ToolCallback<
        Record<string, unknown>,
        never,
        TUser,
        HasOAuth<TUser>,
        TEnv
      >,
    });
    return Object.freeze({
      name: definition.name,
    }) as ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>>;
  }

  /**
   * Prime the views registry from build/dev registry data.
   *
   * @param views - Registry map keyed by view directory name.
   * @param options - Priming options. When `dev` is true, resource CSP
   * emission appends the serving origin's websocket variant to
   * `connectDomains` so Vite HMR passes host-enforced CSP. Pass
   * `projectRoot` in dev so the `public/` route resolves against the user's
   * project directory rather than the CLI process cwd.
   * @throws If views are already primed, or after the server has started.
   *
   * @internal
   */
  [registerViews](
    views: ViewsManifest,
    options?: { dev?: boolean; projectRoot?: string }
  ): void {
    if (this.#viewsPrimed) {
      throw new Error(
        "Cannot prime views: the views registry is already primed on this server instance."
      );
    }
    this.#assertNotStarted("views", "manifest");
    this.#viewsDevMode = options?.dev === true;
    if (options?.projectRoot !== undefined) {
      this.#viewsProjectRoot = options.projectRoot;
    }
    for (const [name, entry] of Object.entries(views)) {
      this.#views.set(name, entry);
    }
    this.#viewsPrimed = true;
  }

  /**
   * Prime the views registry — string-keyed alias for {@link registerViews}
   * used by the CLI when the symbol export cannot be shared across duplicate
   * module copies (dev module runner with an externalized package).
   *
   * @param views - Manifest map keyed by view directory name.
   * @param options - Priming options forwarded to {@link registerViews}.
   * @throws If views are already primed, or after the server has started.
   *
   * @internal
   */
  __primeViews(
    views: ViewsManifest,
    options?: { dev?: boolean; projectRoot?: string }
  ): void {
    this[registerViews](views, options);
  }

  /** Register a static resource readable at `definition.uri`. */
  resource(
    definition: ResourceDefinition,
    callback: ResourceCallback<TUser, HasOAuth<TUser>, TEnv>
  ): this {
    this.#assertNotStarted("resource", definition.name);
    const previous = this.#resources.get(definition.name);
    if (previous !== undefined)
      this.#proxiedResources.delete(previous.definition.uri);
    this.#resources.set(definition.name, { definition, callback });
    return this;
  }

  /**
   * Register a parameterized resource. Reads matching `uriTemplate` invoke
   * the callback with the extracted variables.
   *
   * The `const` type parameter keeps `uriTemplate` a string literal during
   * inference (plain generic inference widens object-literal properties to
   * `string`), which is what lets `InferTemplateParams` type the callback's
   * `params` from the template's variables.
   */
  resourceTemplate<const TUriTemplate extends string>(
    definition: ResourceTemplateDefinition<TUriTemplate>,
    callback: ResourceTemplateCallback<
      InferTemplateParams<{ uriTemplate: TUriTemplate }>,
      TUser,
      HasOAuth<TUser>,
      TEnv
    >
  ): this {
    this.#assertNotStarted("resourceTemplate", definition.name);
    const complete =
      definition.complete === undefined
        ? undefined
        : normalizeCompletions(definition.complete);
    this.#resourceTemplates.set(definition.name, {
      definition,
      ...(complete !== undefined && { complete }),
      callback: callback as ResourceTemplateCallback<
        Record<string, TemplateVariableValue>,
        TUser,
        HasOAuth<TUser>,
        TEnv
      >,
    });
    return this;
  }

  /**
   * Register a prompt template. Schema fields wrapped with `completable()`
   * gain autocomplete via `completion/complete`.
   */
  prompt<T extends PromptDefinition>(
    definition: T,
    callback: PromptCallback<InferPromptInput<T>, TUser, HasOAuth<TUser>, TEnv>
  ): this {
    this.#assertNotStarted("prompt", definition.name);
    this.#proxiedPrompts.delete(definition.name);
    this.#prompts.set(definition.name, {
      definition,
      callback: callback as PromptCallback<
        Record<string, unknown>,
        TUser,
        HasOAuth<TUser>,
        TEnv
      >,
    });
    return this;
  }

  /**
   * Compose upstream MCP servers into this server.
   *
   * A name-keyed HTTP config creates upstream connections through the optional
   * `@mcp-use/client` v2 peer. Each key automatically namespaces its mounted
   * tools, resources, and prompts. You may instead pass an existing ready
   * {@link ProxyConnection}; its negotiated server name becomes the namespace
   * and the connection remains caller-owned.
   *
   * Connection, introspection, and collision failures are diagnosed and
   * skipped without discarding capabilities that can be mounted.
   *
   * @param servers - Namespace-keyed upstream HTTP connection settings.
   * @throws If `@mcp-use/client` is not installed or the server already started
   * or closed.
   *
   * @example
   * ```ts
   * await server.proxy({
   *   weather: {
   *     url: "https://weather.example.com/mcp",
   *     authToken: process.env.WEATHER_MCP_TOKEN,
   *   },
   * });
   * ```
   */
  async proxy(servers: Record<string, ProxyServerConfig>): Promise<void>;
  /**
   * Mount an existing ready `@mcp-use/client` v2 connection.
   *
   * @param connection - Ready connection to introspect and forward through.
   * The connection's negotiated server name automatically namespaces every
   * mounted capability. Introspection and collision failures are diagnosed and
   * skipped without discarding capabilities that can be mounted.
   *
   * @throws If the server already started or closed.
   *
   * @example
   * ```ts
   * const connection = await client.connect("database");
   * await server.proxy(connection);
   * ```
   */
  async proxy(connection: ProxyConnection): Promise<void>;
  async proxy(
    input: Record<string, ProxyServerConfig> | ProxyConnection
  ): Promise<void> {
    this.#assertOpen("proxy()");
    const operation = (async (): Promise<void> => {
      const { isProxyConnection, mountProxyConnection, mountProxyServers } =
        await import("./mcp-proxy.js");
      if (isProxyConnection(input)) {
        this.#proxyServersConfigured += 1;
        await mountProxyConnection(this.#proxyHost(), input);
        return;
      }
      this.#proxyServersConfigured += Object.keys(input).length;
      await mountProxyServers(this.#proxyHost(), input);
    })();
    this.#proxyOperations.add(operation);
    try {
      await operation;
    } finally {
      this.#proxyOperations.delete(operation);
    }
  }

  /**
   * Register HTTP middleware or typed MCP operation middleware.
   *
   * MCP patterns always use an `mcp:` prefix (for example
   * `mcp:tools/call`, `mcp:*`). Every other overload is Hono middleware and
   * may target all routes or a path pattern.
   *
   * Exact methods may transform their typed result. The global `mcp:*` pattern
   * is pass-through middleware. Middleware runs in registration order; call
   * `next()` to continue the chain.
   *
   * @example
   * ```ts
   * server.use("/api/*", async (c, next) => {
   *   c.set("requestId", crypto.randomUUID());
   *   await next();
   * });
   *
   * server.use("mcp:tools/call", async (ctx, next) => {
   *   console.log(`Calling tool: ${ctx.params.name}`);
   *   return next();
   * });
   * ```
   */
  use<P extends McpMiddlewarePattern>(
    pattern: P,
    handler: McpMiddlewareFnFor<P, TEnv>
  ): this;
  use(handler: MiddlewareHandler<TEnv>): this;
  use(path: `/${string}` | "*", ...handlers: MiddlewareHandler<TEnv>[]): this;
  use(
    patternOrHandler: string | MiddlewareHandler<TEnv>,
    ...handlers: unknown[]
  ): this {
    if (
      typeof patternOrHandler === "string" &&
      patternOrHandler.startsWith("mcp:")
    ) {
      this.#assertNotStarted("middleware", patternOrHandler);
      const handler = handlers[0] as McpMiddlewareFnFor<
        McpMiddlewarePattern,
        TEnv
      >;
      this.#mcpMiddlewares.push(
        createMcpMiddlewareEntry(
          patternOrHandler as McpMiddlewarePattern,
          handler
        )
      );
      return this;
    }

    const register = this.app.use as (...args: unknown[]) => unknown;
    register.call(this.app, patternOrHandler, ...handlers);
    this.#httpMiddlewareCount +=
      typeof patternOrHandler === "function" ? 1 : handlers.length;
    return this;
  }

  /**
   * Register a read-only MCP observer. Unlike {@link MCPServer.use}, listeners
   * cannot block, override, or mutate params. Throwing is logged and does not
   * fail the request.
   *
   * Append `:complete` to run after the handler (for example
   * `mcp:tools/call:complete`).
   *
   * @example
   * ```ts
   * server.on("mcp:tools/call", (ctx) => {
   *   metrics.increment("tools.call", { tool: ctx.params.name });
   * });
   * ```
   */
  on<P extends McpEventPattern>(
    pattern: P,
    handler: McpEventListenerFnFor<P, TEnv>
  ): this {
    this.#assertNotStarted("event listener", pattern);
    this.#mcpEventListeners.push(createMcpEventListenerEntry(pattern, handler));
    return this;
  }

  /**
   * Attach the shared development event bus before the first request.
   *
   * @param bus - Bus retained across hot-reloaded server instances.
   * @internal
   */
  __setEventBus(bus: ServerEventBus): void {
    this.#assertNotStarted("event bus", "shared");
    this.#eventBus = bus;
  }

  /** Mount and validate the Hono/MCP application without serving a request. @internal */
  __mount(): void {
    this.#ensureMounted("handler");
  }

  /**
   * Publish a tools-list change to v2 clients with active subscriptions.
   *
   * @example
   * ```ts
   * await server.notifyToolsChanged();
   * ```
   */
  async notifyToolsChanged(): Promise<void> {
    await this.#ensureMounted("handler").handler.notify.toolsChanged();
  }

  /**
   * Publish a prompts-list change to v2 clients with active subscriptions.
   *
   * @example
   * ```ts
   * await server.notifyPromptsChanged();
   * ```
   */
  async notifyPromptsChanged(): Promise<void> {
    await this.#ensureMounted("handler").handler.notify.promptsChanged();
  }

  /**
   * Publish a resources-list change to v2 clients with active subscriptions.
   *
   * @example
   * ```ts
   * await server.notifyResourcesChanged();
   * ```
   */
  async notifyResourcesChanged(): Promise<void> {
    await this.#ensureMounted("handler").handler.notify.resourcesChanged();
  }

  /**
   * Publish a resource update to subscribed v2 clients.
   *
   * @param uri - Resource URI whose representation changed.
   *
   * @example
   * ```ts
   * await server.notifyResourceUpdated("config://settings");
   * ```
   */
  async notifyResourceUpdated(uri: string): Promise<void> {
    await this.#ensureMounted("handler").handler.notify.resourceUpdated(uri);
  }

  /**
   * Serve over HTTP on Node. Pass port `0` for an ephemeral port. Port
   * precedence is the argument, `PORT`, `config.port`, then `3000`; host
   * precedence is `options.host`, `HOST`, `config.host`, then `127.0.0.1`.
   *
   * Localhost-class binds get
   * DNS-rebinding Host protection automatically. Origin validation is off
   * unless `allowedOrigins` is set. To serve publicly set `host: "0.0.0.0"`;
   * behind a platform edge that is all that's needed, and `allowedHosts`
   * restricts direct exposure (additive — localhost-class values stay allowed).
   *
   * With OAuth and no explicit resource or `MCP_URL`, a localhost listener
   * derives its protected-resource URL from the actual bound port. Mounting
   * therefore waits for the listener callback (especially for port `0`), and
   * requests accepted before then are queued. Public/wildcard listeners must
   * configure the resource before calling this method.
   *
   * @throws If called on a localhost-class bind after {@link MCPServer.fetch}
   * already mounted the app without Host validation.
   */
  async listen(
    port: number | undefined = undefined,
    options: ListenOptions = {}
  ): Promise<{
    /** Actual bound port, including an ephemeral port chosen for `0`. */
    port: number;
    /** HTTP URL of the bound MCP endpoint. */
    url: string;
  }> {
    this.#assertOpen("listen()");
    const host = resolveListenHost(options.host, this.#config.host);
    const requestedPort = resolveListenPort(port, this.#config.port);
    this.#assertListenOAuthConfiguration(host);

    return new Promise((resolve, reject) => {
      let resolveFetch: ((fetch: FetchHandler) => void) | undefined;
      let rejectFetch: ((error: unknown) => void) | undefined;
      const fetchReady = new Promise<FetchHandler>(
        (resolveFetchPromise, rejectFetchPromise) => {
          resolveFetch = resolveFetchPromise;
          rejectFetch = rejectFetchPromise;
        }
      );
      void fetchReady.catch(() => undefined);

      let settled = false;
      const rejectAndClose = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        rejectFetch?.(error);
        void new Promise<void>((closeResolve) =>
          server.close(() => closeResolve())
        )
          .catch(() => undefined)
          .finally(() => {
            if (this.#httpServer === server) {
              this.#httpServer = undefined;
            }
          });
      };

      const nodeHandler = toNodeHandler({
        fetch: async (request) => (await fetchReady)(request),
      });
      const server = createNodeHttpServer((req, res) => {
        void nodeHandler(req, res);
      }) as NodeHttpListener;

      server.once("error", rejectAndClose);
      server.listen(requestedPort, host, () => {
        try {
          const address = server.address();
          const boundPort =
            typeof address === "object" && address !== null
              ? address.port
              : requestedPort;
          const { fetch } = this.#ensureMounted("listen", boundPort, host);
          resolveFetch?.(fetch);
          if (!settled) {
            settled = true;
            resolve({
              port: boundPort,
              url: `http://localhost:${boundPort}${this.#basePath()}`,
            });
          }
        } catch (error) {
          rejectAndClose(error);
        }
      });
      this.#httpServer = server;
    });
  }

  /**
   * Abort in-flight MCP exchanges and stop the HTTP listener.
   *
   * A closed server is done for good — the underlying MCP handler stays
   * closed, so `listen()`/`fetch()` cannot revive it. Create a new
   * instance to serve again.
   */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled([...this.#proxyOperations]);

    const errors: unknown[] = [];
    const proxyOwners = this.#proxyOwners.splice(0);
    const ownerResults = await Promise.allSettled(
      proxyOwners.map((owner) => owner.close())
    );
    for (const result of ownerResults) {
      if (result.status === "rejected") errors.push(result.reason);
    }

    try {
      await this.#handler?.close();
    } catch (error) {
      errors.push(error);
    }
    const httpServer = this.#httpServer;
    if (httpServer !== undefined) {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
        this.#httpServer = undefined;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close MCP server cleanly");
    }
  }

  #assertOpen(operation?: string): void {
    if (!this.#closed) return;
    if (operation !== undefined) {
      throw new Error(`Cannot call ${operation} after the server has closed.`);
    }
    throw new Error("Cannot use the server after it has closed.");
  }

  #basePath(): string {
    return this.#config.basePath ?? "/mcp";
  }

  #resolveOAuthResource(
    mode: "listen" | "handler",
    listenPort?: number,
    listenHost?: string
  ): URL | undefined {
    if (this.#config.oauth === undefined) {
      return undefined;
    }
    if (this.#oauthResourceResolved) {
      return this.#oauthResource;
    }

    const host = listenHost ?? this.#config.host ?? "127.0.0.1";
    const localListen =
      mode === "listen" &&
      listenPort !== undefined &&
      ["127.0.0.1", "localhost", "::1"].includes(host);
    if (this.#oauthResourceConfigurationAbsent && localListen) {
      this.#oauthResource = resolveLocalOAuthResource(
        `http://localhost:${listenPort}`,
        this.#basePath()
      );
      this.#oauthResourceResolved = true;
      return this.#oauthResource;
    }

    throw new Error(
      "OAuth requires an explicit resource or MCP_URL when using server.fetch or listening on a non-local host"
    );
  }

  #assertListenOAuthConfiguration(host: string): void {
    if (this.#config.oauth === undefined) {
      return;
    }
    if (["127.0.0.1", "localhost", "::1"].includes(host)) {
      return;
    }
    if (!this.#oauthResourceResolved) {
      // Public/wildcard listeners have no stable local fallback. Their
      // configured resource was already validated during construction.
      throw new Error(
        "OAuth listen() on a public or wildcard host requires an explicit provider resource or valid MCP_URL."
      );
    }
  }

  #assertNotStarted(kind: string, name: string): void {
    if (this.#handler !== undefined) {
      throw new Error(
        `Cannot register ${kind} "${name}" after the server has started: ` +
          `registrations are replayed per request from the registry, ` +
          `so register everything before listen()/server.fetch.`
      );
    }
  }

  #trackConfigured(): void {
    recordUsage(
      "server",
      "configured",
      {
        tools_total: this.#tools.size,
        tools_local:
          this.#tools.size - this.#openApiTools.size - this.#proxiedTools.size,
        tools_openapi: this.#openApiTools.size,
        tools_proxied: this.#proxiedTools.size,
        resources: this.#resources.size,
        resource_templates: this.#resourceTemplates.size,
        prompts: this.#prompts.size,
        views: this.#views.size,
        proxy_servers_configured: this.#proxyServersConfigured,
        proxy_servers_connected: this.#proxyServersConnected,
        proxy_tools_discovered: this.#proxyToolsDiscovered,
        proxy_resources_discovered: this.#proxyResourcesDiscovered,
        proxy_prompts_discovered: this.#proxyPromptsDiscovered,
        proxy_tools_mounted: this.#proxiedTools.size,
        proxy_resources_mounted: this.#proxiedResources.size,
        proxy_prompts_mounted: this.#proxiedPrompts.size,
        http_middleware: this.#httpMiddlewareCount,
        mcp_middleware: this.#mcpMiddlewares.length,
        observers_before: this.#mcpEventListeners.filter(
          ({ phase }) => phase === "before"
        ).length,
        observers_complete: this.#mcpEventListeners.filter(
          ({ phase }) => phase === "complete"
        ).length,
        oauth_configured: this.#config.oauth !== undefined,
        cors_configured: this.#config.cors !== undefined,
        request_state_configured: this.#config.requestState !== undefined,
        legacy_policy: this.#config.legacy ?? "stateless",
      },
      {
        onceKey: `${this.#usageScopeId()}:server`,
        serverRoot: this.#viewsProjectRoot,
      }
    );
  }

  #trackClient(body: unknown): void {
    const client = clientUsageFromBody(body);
    if (client === undefined) return;
    recordUsage(
      "client",
      "observed",
      { ...client },
      {
        onceKey: `${this.#usageScopeId()}:client:${JSON.stringify(client)}`,
        serverRoot: this.#viewsProjectRoot,
      }
    );
  }

  #usageScopeId(): string {
    this.#usageScope ??= crypto.randomUUID();
    return this.#usageScope;
  }

  #proxyHost(): ProxyMountHost {
    return {
      isStarted: () => this.#handler !== undefined,
      hasTool: (name) => this.#tools.has(name),
      hasResource: (name) => this.#resources.has(name),
      hasPrompt: (name) => this.#prompts.has(name),
      registerTool: (definition, callback) => {
        this.#assertNotStarted("tool", definition.name);
        this.#proxiedTools.add(definition.name);
        this.#tools.set(definition.name, {
          definition,
          callback: callback as unknown as ToolCallback<
            Record<string, unknown>,
            never,
            TUser,
            HasOAuth<TUser>,
            TEnv
          >,
        });
      },
      registerResource: (definition, callback) => {
        this.#assertNotStarted("resource", definition.name);
        this.#proxiedResources.add(definition.uri);
        this.#resources.set(definition.name, {
          definition,
          callback: callback as unknown as ResourceCallback<
            TUser,
            HasOAuth<TUser>,
            TEnv
          >,
        });
      },
      registerPrompt: (definition, callback) => {
        this.#assertNotStarted("prompt", definition.name);
        this.#proxiedPrompts.add(definition.name);
        this.#prompts.set(definition.name, {
          definition,
          callback: callback as unknown as PromptCallback<
            Record<string, unknown>,
            TUser,
            HasOAuth<TUser>,
            TEnv
          >,
        });
      },
      trackOwner: (owner) => {
        this.#proxyOwners.push(owner);
      },
      trackNamespace: ({ tools, resources, prompts }) => {
        this.#proxyServersConnected += 1;
        this.#proxyToolsDiscovered += tools;
        this.#proxyResourcesDiscovered += resources;
        this.#proxyPromptsDiscovered += prompts;
      },
    };
  }

  /**
   * Effective Host/Origin allowlists for a mount mode; `undefined` means the
   * corresponding validation is off.
   *
   * Configured lists are additive to the localhost-class allowlists, so local
   * runs keep working when a deployment hostname is added. With nothing
   * configured, `listen()` on a localhost-class bind validates Host against the
   * localhost lists (the DNS-rebinding threat model), while `server.fetch` —
   * which never binds — applies no validation. Origin validation is off unless
   * `allowedOrigins` is set explicitly (SDK-aligned: the handler is open by
   * default). When enabled, Origin is checked only on non-GET/HEAD requests.
   */
  #validationPolicy(
    mode: "listen" | "handler",
    listenHost?: string
  ): {
    hosts: string[] | undefined;
    origins: string[] | undefined;
  } {
    const { allowedHosts, allowedOrigins } = this.#config;
    const host = listenHost ?? this.#config.host ?? "127.0.0.1";
    const localhostBind = ["127.0.0.1", "localhost", "::1"].includes(host);
    const hosts =
      allowedHosts !== undefined
        ? [...new Set([...localhostAllowedHostnames(), ...allowedHosts])]
        : mode === "listen" && localhostBind
          ? localhostAllowedHostnames()
          : undefined;
    const origins =
      allowedOrigins !== undefined
        ? [...new Set([...localhostAllowedOrigins(), ...allowedOrigins])]
        : undefined;
    return { hosts, origins };
  }

  #ensureMounted(
    mode: "listen" | "handler",
    listenPort?: number,
    listenHost?: string
  ): {
    fetch: FetchHandler;
    handler: McpHttpHandler;
  } {
    this.#assertOpen();
    if (this.#fetchHandler === undefined || this.#handler === undefined) {
      const { hosts, origins } = this.#validationPolicy(mode, listenHost);
      const basePath = this.#basePath();
      const nestedBasePath = basePath === "/" ? "" : basePath;
      const httpApp = new Hono<TEnv>();
      const middlewares = [
        jsonBodyMiddleware(),
        requestLogger(this.#config.logging),
      ];

      const corsConfig = this.#config.cors;
      if (corsConfig !== undefined) {
        middlewares.unshift(corsFetchMiddleware(corsConfig));
      }
      const deferViewCors = isGlobalCorsEnabled(corsConfig);

      if (hosts !== undefined) {
        middlewares.unshift(hostValidationMiddleware(hosts));
      }
      if (origins !== undefined) {
        middlewares.push(originValidationMiddleware(origins));
      }
      if (hosts === undefined) {
        if (mode === "listen") {
          console.warn(
            `[mcp-use] listen() is serving on ${listenHost} without ` +
              `Host validation. Behind a platform edge that only routes your ` +
              `own domains this is expected; if this process is reachable ` +
              `directly, set allowedHosts to restrict it.`
          );
        }
      }

      this.#validateViewBindingsAtMount();

      const resource = this.#resolveOAuthResource(mode, listenPort, listenHost);
      if (resource !== undefined) {
        const provider = this.#config.oauth!;
        middlewares.push(oauthMetadata(provider, resource));
      }

      for (const middleware of middlewares) {
        registerFetchMiddleware(httpApp, middleware);
      }

      const { handler, fetch: mcpFetch } = createMcpMount(
        (ctx) => this.#buildSdkServer(ctx),
        {
          path: basePath,
          ...((this.#config.legacy !== undefined ||
            this.#eventBus !== undefined) && {
            handler: {
              ...(this.#config.legacy !== undefined && {
                legacy: this.#config.legacy,
              }),
              ...(this.#eventBus !== undefined && { bus: this.#eventBus }),
            },
          }),
          ...(resource !== undefined && {
            authInfo: (request) => authInfoFromRequest(request),
          }),
        }
      );

      let protectWithBearer: (
        request: Request,
        next: () => Promise<Response>
      ) => Promise<Response> = async (_request, next) => next();
      if (resource !== undefined) {
        const provider = this.#config.oauth!;
        const providerOptions = getOAuthProviderOptions(provider);
        const gate = requireBearerAuth({
          verifier: wrapOAuthTokenVerifier(provider, resource),
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
          ...(providerOptions.requiredScopes !== undefined && {
            requiredScopes: providerOptions.requiredScopes,
          }),
        });
        protectWithBearer = async (request, next) => {
          const result = await gate(request);
          if (result instanceof Response) {
            return result;
          }
          const bag = getRequestBag(request);
          bag.authInfo = result;
          return next();
        };

        // Authenticate the exact MCP route before the user-owned Hono app
        // runs. This makes verified identity available to route middleware
        // while leaving OAuth discovery, assets, and unrelated custom routes
        // public. The explicitly public HTML landing-page carveout remains the
        // only unauthenticated request allowed through this route.
        httpApp.use("*", async (context, next) => {
          if (new URL(context.req.url).pathname !== basePath) {
            await next();
            return;
          }
          if (
            this.#config.publicLandingPage === true &&
            isHtmlNavigationRequest(context.req.raw)
          ) {
            await next();
            return;
          }
          const response = await protectWithBearer(
            context.req.raw,
            async () => {
              await next();
              return context.res;
            }
          );
          context.res = response;
          return response;
        });
      }

      const mcpRouteHandler: FetchHandler = (request) => {
        const body = getRequestBag(request).parsedBody;
        if (isJSONRPCRequest(body)) {
          this.#trackConfigured();
          this.#trackClient(body);
        }
        return mcpFetch(request);
      };
      const endpointHandler: FetchHandler = async (request) => {
        if (!isHtmlNavigationRequest(request)) {
          return mcpRouteHandler(request);
        }
        const respond = async (): Promise<Response> => {
          const { createLandingPageResponse } =
            await import("./landing-handler.js");
          return createLandingPageResponse(
            request,
            basePath,
            this.#config,
            this.#branding,
            this.#tools.values(),
            this.#prompts.values(),
            this.#resources.values()
          );
        };
        return respond();
      };

      const brandingDevMode = this.#viewsPrimed
        ? this.#viewsDevMode
        : process.env["NODE_ENV"] !== "production";
      const faviconHandler = createFaviconHandler(this.#branding, {
        dev: brandingDevMode,
        projectRoot: this.#viewsProjectRoot,
        deferCors: deferViewCors,
      });
      if (faviconHandler !== undefined) {
        this.app.all("/favicon.ico", (context) =>
          faviconHandler(context.req.raw)
        );
      }

      const viewHandler = createViewPublicHandler(basePath, this.#views, {
        dev: this.#viewsPrimed ? this.#viewsDevMode : brandingDevMode,
        projectRoot: this.#viewsProjectRoot,
        enabled: hasLocalBrandingAsset(this.#branding),
        deferCors: deferViewCors,
      });
      if (viewHandler !== undefined) {
        this.app.on(
          ["GET", "HEAD"],
          `${nestedBasePath}/_mcp-use/public/*`,
          (context) => viewHandler(context.req.raw)
        );
      }

      if (!this.#viewsDevMode) {
        const viewAssetsHandler = createViewAssetsHandler(
          basePath,
          this.#views,
          { projectRoot: this.#viewsProjectRoot, deferCors: deferViewCors }
        );
        if (viewAssetsHandler !== undefined) {
          this.app.on(
            ["GET", "HEAD"],
            `${nestedBasePath}/_mcp-use/views/*`,
            (context) => viewAssetsHandler(context.req.raw)
          );
        }
      }

      this.app.all(basePath, (context) => endpointHandler(context.req.raw));
      httpApp.route("/", this.app);
      this.#httpApp = httpApp;
      this.#fetchHandler = async (request) => httpApp.fetch(request);
      this.#handler = handler;
      this.#hostValidated = hosts !== undefined;
    } else if (
      mode === "listen" &&
      !this.#hostValidated &&
      this.#validationPolicy("listen", listenHost).hosts !== undefined
    ) {
      throw new Error(
        "Cannot listen() on a localhost bind after server.fetch mounted the app " +
          "without Host validation (server.fetch expects a platform edge in " +
          "front). Call listen() first, or set allowedHosts."
      );
    }
    return { fetch: this.#fetchHandler!, handler: this.#handler! };
  }

  #validateToolViewBinding(definition: ToolDefinition): void {
    const view = definition.view;
    if (view === undefined) {
      return;
    }
    if (definition.outputSchema === undefined) {
      throw new Error(
        `Tool "${definition.name}" declares view "${view.name}" but has no outputSchema. ` +
          `View-bound tools require an outputSchema — the view reads structuredContent typed from it. ` +
          `Use outputSchema: z.object({}) for a view that takes no structured output.`
      );
    }

    const existing = this.#viewBindings.get(view.name);
    if (existing !== undefined) {
      throw new Error(
        `View "${view.name}" is already bound to tool "${existing.toolName}"; ` +
          `tool "${definition.name}" cannot bind the same view. ` +
          `Each view may be bound to one tool.`
      );
    }

    this.#viewBindings.set(view.name, {
      toolName: definition.name,
      config: view,
    });
  }

  #validateViewBindingsAtMount(): void {
    if (this.#viewBindings.size > 0 && !this.#viewsPrimed) {
      const first = [...this.#tools.values()].find(
        (entry) => entry.definition.view !== undefined
      );
      const viewName = first?.definition.view?.name ?? "unknown";
      throw new Error(
        `Tool "${first?.definition.name ?? "unknown"}" is bound to view "${viewName}" ` +
          `but no views were primed. Run \`mcp-use build\` and deploy the built entry, ` +
          `or in dev let the CLI prime views automatically.`
      );
    }

    for (const entry of this.#tools.values()) {
      const viewName = entry.definition.view?.name;
      if (viewName !== undefined && !this.#views.has(viewName)) {
        throw new Error(
          `Tool "${entry.definition.name}" is bound to view "${viewName}" ` +
            `which is not in the primed views registry. Run \`mcp-use build\` ` +
            `and deploy the built entry, or in dev let the CLI prime views automatically.`
        );
      }
    }

    for (const viewName of this.#views.keys()) {
      if (!this.#viewBindings.has(viewName)) {
        console.warn(
          `[mcp-use] View "${viewName}" is registered but no tool binds it.`
        );
      }
    }
  }

  /** Build a fully registered SDK server from the immutable registry. */
  #buildSdkServer(ctx: McpRequestContext): SdkMcpServer {
    const { name, version, title, description, instructions } = this.#config;
    const authInfo = ctx.authInfo;
    const server = new SdkMcpServer(
      {
        name,
        version,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(this.#branding.websiteUrl !== undefined && {
          websiteUrl: this.#branding.websiteUrl,
        }),
        ...(this.#branding.icons !== undefined && {
          icons: resolveImplementationIcons(
            this.#branding.icons,
            ctx.requestInfo,
            this.#basePath()
          ),
        }),
      },
      {
        capabilities: {
          logging: {},
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
        },
        ...(instructions !== undefined && { instructions }),
        ...(authInfo !== undefined && { authInfo }),
        ...(this.#config.requestState !== undefined && {
          requestState: this.#config.requestState,
        }),
      }
    );

    const request = ctx.requestInfo;
    const viewMetaOptions =
      request !== undefined
        ? { request, hmrWs: this.#viewsDevMode }
        : { hmrWs: this.#viewsDevMode };
    const basePath = this.#basePath();

    for (const entry of this.#tools.values()) {
      this.#registerTool(server, entry);
    }
    for (const entry of this.#resources.values()) {
      this.#registerResource(server, entry);
    }
    for (const entry of this.#resourceTemplates.values()) {
      this.#registerResourceTemplate(server, entry);
    }
    for (const entry of this.#prompts.values()) {
      this.#registerPrompt(server, entry);
    }
    for (const [viewName, viewEntry] of this.#views.entries()) {
      this.#registerViewResource(
        server,
        viewName,
        viewEntry,
        viewMetaOptions,
        basePath
      );
    }
    this.#wrapListHandlers(server);
    return server;
  }

  #createMiddlewareContext<M extends McpMiddlewareMethod>(
    method: M,
    params: MiddlewareContext<M, TEnv>["params"],
    ctx: ServerContext
  ): MiddlewareContext<M, TEnv> {
    const requestContext = toRequestContext<TEnv>(ctx);
    return Object.assign(requestContext, {
      method,
      params,
      ...(ctx.sessionId !== undefined && {
        session: { sessionId: ctx.sessionId },
      }),
      ...(ctx.http?.authInfo !== undefined && { auth: ctx.http.authInfo }),
      state: new Map(),
    }) as unknown as MiddlewareContext<M, TEnv>;
  }

  #runMcpHook<M extends McpMiddlewareMethod>(
    method: M,
    ctx: MiddlewareContext<M, TEnv>,
    innerFn: () => Promise<McpMiddlewareResult<M>>
  ): Promise<McpMiddlewareResult<M>> {
    // The upstream SDK validates every tools/call result against
    // CallToolResultSchema before it reaches the transport. When there are no
    // middleware entries or observers, running the middleware pipeline would
    // only repeat that full schema parse.
    const runOperation =
      method === "tools/call" &&
      this.#mcpMiddlewares.length === 0 &&
      this.#mcpEventListeners.length === 0
        ? innerFn
        : () =>
            runMcpOperation(
              this.#mcpMiddlewares,
              this.#mcpEventListeners,
              method,
              ctx,
              innerFn
            );

    if (isUsageDisabled()) {
      return runOperation();
    }

    const startedAt = performance.now();
    const matchedMiddleware = this.#mcpMiddlewares.filter((entry) =>
      matchesPattern(entry.pattern, method)
    ).length;
    const matchedObservers = (phase: "before" | "complete") =>
      this.#mcpEventListeners.filter(
        (entry) =>
          entry.phase === phase && matchesPattern(entry.pattern, method)
      ).length;
    const request = ctx.request?.raw;
    const client =
      request === undefined
        ? undefined
        : clientUsageFromBody(getRequestBag(request).parsedBody);
    const capture = (
      outcome: "success" | "error" | "input_required",
      completedPhase: boolean
    ): void => {
      recordUsage(
        "operation",
        "completed",
        {
          method,
          outcome,
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          primitive_origin: this.#primitiveOrigin(method, ctx.params),
          matched_middleware: matchedMiddleware,
          observers_before: matchedObservers("before"),
          observers_complete: completedPhase ? matchedObservers("complete") : 0,
          ...(client?.protocol_era === "modern"
            ? client
            : { client_name: "unknown", protocol_era: "legacy" }),
        },
        {
          sampleRate: outcome === "success" ? 0.1 : 1,
          serverRoot: this.#viewsProjectRoot,
        }
      );
    };
    return runOperation().then(
      (result) => {
        const outcome = isInputRequiredResult(result)
          ? "input_required"
          : method === "tools/call" &&
              typeof result === "object" &&
              result !== null &&
              "isError" in result &&
              result.isError === true
            ? "error"
            : "success";
        capture(outcome, true);
        return result;
      },
      (error: unknown) => {
        capture("error", false);
        throw error;
      }
    );
  }

  #primitiveOrigin(
    method: McpMiddlewareMethod,
    params: Record<string, unknown>
  ): "local" | "openapi" | "proxied" | "mixed" {
    if (method === "tools/call") {
      const name = String(params["name"]);
      if (this.#proxiedTools.has(name)) return "proxied";
      if (this.#openApiTools.has(name)) return "openapi";
      return "local";
    }
    if (method === "resources/read") {
      return this.#proxiedResources.has(String(params["uri"]))
        ? "proxied"
        : "local";
    }
    if (method === "prompts/get") {
      return this.#proxiedPrompts.has(String(params["name"]))
        ? "proxied"
        : "local";
    }
    return "mixed";
  }

  /**
   * Wrap native SDK list handlers with the MCP middleware chain.
   *
   * ponytail: uses SDK-private `_requestHandlers`; pin compile-time test.
   *
   * @internal
   */
  #wrapListHandlers(server: SdkMcpServer): void {
    type RequestHandler = (
      request: unknown,
      extra: unknown
    ) => Promise<unknown>;
    const handlers = (
      server.server as unknown as {
        _requestHandlers?: Map<string, RequestHandler>;
      }
    )._requestHandlers;
    if (handlers === undefined) {
      return;
    }

    type ListMethod = "tools/list" | "resources/list" | "prompts/list";
    type ListResultKey<M extends ListMethod> = M extends "tools/list"
      ? "tools"
      : M extends "resources/list"
        ? "resources"
        : "prompts";

    const wrapListMethod = <M extends ListMethod>(
      method: M,
      resultKey: ListResultKey<NoInfer<M>>,
      transform?: (
        items: McpMiddlewareResult<NoInfer<M>>
      ) => McpMiddlewareResult<NoInfer<M>>
    ) => {
      const original = handlers.get(method);
      if (original === undefined) {
        return;
      }
      if ((original as { __mcpListWrapped?: boolean }).__mcpListWrapped) {
        return;
      }

      const wrapped = async (request: unknown, extra: unknown) => {
        const serverContext = extra as ServerContext;
        const params =
          (request as { params?: MiddlewareContext<M, TEnv>["params"] })
            .params ?? ({} as MiddlewareContext<M, TEnv>["params"]);
        const mwCtx = this.#createMiddlewareContext(
          method,
          params,
          serverContext
        );
        let originalEnvelope: Record<string, unknown> | undefined;
        const innerFn = async (): Promise<McpMiddlewareResult<M>> => {
          const downstreamRequest = withMcpMiddlewareParams<M>(
            request,
            mwCtx.params
          );
          const result = await original(downstreamRequest, extra);
          if (typeof result !== "object" || result === null) {
            throw new TypeError(
              `[mcp-use] ${method} handler returned a non-object result`
            );
          }
          originalEnvelope = result as Record<string, unknown>;
          const items = originalEnvelope[resultKey];
          if (!Array.isArray(items)) {
            throw new TypeError(
              `[mcp-use] ${method} handler result is missing a ${resultKey} array`
            );
          }
          return items as McpMiddlewareResult<M>;
        };
        const filtered = await this.#runMcpHook(method, mwCtx, innerFn);
        if (!Array.isArray(filtered)) {
          throw new TypeError(
            `[mcp-use] ${method} middleware must return a ${resultKey} array`
          );
        }
        const emitted = transform?.(filtered) ?? filtered;
        return {
          ...originalEnvelope,
          [resultKey]: emitted,
        };
      };
      (wrapped as { __mcpListWrapped?: boolean }).__mcpListWrapped = true;
      handlers.set(method, wrapped);
    };

    wrapListMethod("tools/list", "tools", omitToolSchemaDialects);
    wrapListMethod("resources/list", "resources");
    wrapListMethod("prompts/list", "prompts");
  }

  #registerTool(
    server: SdkMcpServer,
    { definition, callback }: ToolEntry<TUser, TEnv>
  ): void {
    const view = definition.view;

    const toolMeta = buildToolUiMeta(
      view?.name,
      definition.visibility,
      definition._meta
    );
    const config = {
      ...(definition.title !== undefined && { title: definition.title }),
      ...(definition.description !== undefined && {
        description: definition.description,
      }),
      ...(definition.annotations !== undefined && {
        annotations: definition.annotations,
      }),
      ...(definition.outputSchema !== undefined && {
        outputSchema: definition.outputSchema,
      }),
      ...(toolMeta !== undefined && { _meta: toolMeta }),
    };
    const wireResultMeta =
      view !== undefined ? buildToolResultUiMeta(view.name) : undefined;

    const inputSchema = resolveToolInputSchema(definition);

    const invokeTool = async (
      args: Record<string, unknown>,
      ctx: ServerContext
    ) => {
      const mwCtx = this.#createMiddlewareContext(
        "tools/call",
        {
          name: definition.name,
          arguments: args,
          ...(ctx.mcpReq._meta !== undefined && { _meta: ctx.mcpReq._meta }),
        },
        ctx
      );
      const innerFn = async () => {
        const effectiveArgs = (mwCtx.params.arguments ?? {}) as Record<
          string,
          unknown
        >;
        const result = await callback(
          effectiveArgs,
          this.#toRequestContext(ctx)
        );
        if (
          isInputRequiredResult(result) ||
          wireResultMeta === undefined ||
          result.isError === true
        ) {
          return result;
        }
        return {
          ...result,
          _meta: { ...result._meta, ...wireResultMeta },
        };
      };
      return (await this.#runMcpHook("tools/call", mwCtx, innerFn)) as Awaited<
        ReturnType<typeof callback>
      >;
    };

    if (inputSchema !== undefined) {
      server.registerTool(
        definition.name,
        { ...config, inputSchema },
        async (args, ctx) => invokeTool(args as Record<string, unknown>, ctx)
      );
    } else {
      server.registerTool(definition.name, config, async (ctx) =>
        invokeTool({}, ctx)
      );
    }
  }

  #registerViewResource(
    server: SdkMcpServer,
    viewName: string,
    entry: ViewManifestEntry,
    metaOptions: { request?: Request; hmrWs?: boolean },
    basePath: string
  ): void {
    const uri = viewResourceUri(viewName);
    const authorFacts = this.#viewResourceFacts(
      this.#viewBindings.get(viewName)?.config
    );
    const resourceConfig = viewResourceConfig(
      viewName,
      entry,
      authorFacts,
      metaOptions
    );
    server.registerResource(
      viewName,
      uri,
      resourceConfig,
      async (readUri, ctx) => {
        const req = ctx.http?.req;
        const readOptions: BuildResourceUiMetaOptions =
          req !== undefined
            ? {
                request: req,
                ...(metaOptions.hmrWs === true ? { hmrWs: true } : {}),
              }
            : metaOptions.hmrWs === true
              ? { hmrWs: true }
              : {};
        const assetsBase =
          req !== undefined
            ? resolveAssetsBase(req)
            : metaOptions.request !== undefined
              ? resolveAssetsBase(metaOptions.request)
              : "";
        const html = synthesizeViewDocument(
          entry,
          assetsBase,
          basePath,
          viewName
        );
        return {
          contents: [
            {
              uri: readUri.href,
              mimeType: resourceConfig.mimeType,
              text: html,
              _meta: buildResourceUiMeta(authorFacts, readOptions),
            },
          ],
        };
      }
    );
  }

  #registerResource(
    server: SdkMcpServer,
    { definition, callback }: ResourceEntry<TUser, TEnv>
  ): void {
    server.registerResource(
      definition.name,
      definition.uri,
      {
        ...(definition.title !== undefined && { title: definition.title }),
        ...(definition.description !== undefined && {
          description: definition.description,
        }),
        ...(definition.mimeType !== undefined && {
          mimeType: definition.mimeType,
        }),
        ...(definition.annotations !== undefined && {
          annotations: definition.annotations,
        }),
        ...(definition._meta !== undefined && {
          _meta: { ...definition._meta },
        }),
      },
      async (uri, ctx) => {
        const mwCtx = this.#createMiddlewareContext(
          "resources/read",
          {
            uri: uri.href,
            ...(ctx.mcpReq._meta !== undefined && { _meta: ctx.mcpReq._meta }),
          },
          ctx
        );
        const innerFn = async () =>
          toResourceResult(
            await callback(uri, this.#toRequestContext(ctx)),
            uri.href
          );
        return await this.#runMcpHook("resources/read", mwCtx, innerFn);
      }
    );
  }

  #registerResourceTemplate(
    server: SdkMcpServer,
    { definition, callback, complete }: ResourceTemplateEntry<TUser, TEnv>
  ): void {
    const template = new ResourceTemplate(definition.uriTemplate, {
      list: undefined,
      ...(complete !== undefined && { complete }),
    });
    server.registerResource(
      definition.name,
      template,
      {
        ...(definition.title !== undefined && { title: definition.title }),
        ...(definition.description !== undefined && {
          description: definition.description,
        }),
        ...(definition.mimeType !== undefined && {
          mimeType: definition.mimeType,
        }),
        ...(definition.annotations !== undefined && {
          annotations: definition.annotations,
        }),
        ...(definition._meta !== undefined && {
          _meta: { ...definition._meta },
        }),
      },
      async (uri, variables, ctx) => {
        const mwCtx = this.#createMiddlewareContext(
          "resources/read",
          {
            uri: uri.href,
            ...(ctx.mcpReq._meta !== undefined && { _meta: ctx.mcpReq._meta }),
          },
          ctx
        );
        const innerFn = async () =>
          toResourceResult(
            await callback(
              uri,
              variables as Record<string, TemplateVariableValue>,
              this.#toRequestContext(ctx)
            ),
            uri.href
          );
        return await this.#runMcpHook("resources/read", mwCtx, innerFn);
      }
    );
  }

  #viewResourceFacts(
    viewConfig: ToolViewConfig | undefined
  ): ViewResourceFacts | undefined {
    if (viewConfig === undefined) {
      return undefined;
    }
    return {
      ...(viewConfig.description !== undefined && {
        description: viewConfig.description,
      }),
      ...(viewConfig.csp !== undefined && { csp: viewConfig.csp }),
      ...(viewConfig.permissions !== undefined && {
        permissions: viewConfig.permissions,
      }),
      ...(viewConfig.domain !== undefined && { domain: viewConfig.domain }),
      ...(viewConfig.prefersBorder !== undefined && {
        prefersBorder: viewConfig.prefersBorder,
      }),
    };
  }

  #registerPrompt(
    server: SdkMcpServer,
    { definition, callback }: PromptEntry<TUser, TEnv>
  ): void {
    const config = {
      ...(definition.title !== undefined && { title: definition.title }),
      ...(definition.description !== undefined && {
        description: definition.description,
      }),
    };
    const invokePrompt = async (
      args: Record<string, unknown>,
      ctx: ServerContext
    ) => {
      const mwCtx = this.#createMiddlewareContext(
        "prompts/get",
        {
          name: definition.name,
          arguments: args as Record<string, string>,
          ...(ctx.mcpReq._meta !== undefined && { _meta: ctx.mcpReq._meta }),
        },
        ctx
      );
      const innerFn = async () => {
        const effectiveArgs = (mwCtx.params.arguments ?? {}) as Record<
          string,
          unknown
        >;
        return toPromptResult(
          await callback(effectiveArgs, this.#toRequestContext(ctx))
        );
      };
      return await this.#runMcpHook("prompts/get", mwCtx, innerFn);
    };

    if (definition.schema !== undefined) {
      server.registerPrompt(
        definition.name,
        { ...config, argsSchema: definition.schema },
        async (args, ctx) => invokePrompt(args as Record<string, unknown>, ctx)
      );
    } else {
      const handler = async (ctx: ServerContext) => invokePrompt({}, ctx);
      server.registerPrompt(
        definition.name,
        config,
        handler as unknown as SdkPromptCallback<StandardSchemaWithJSON>
      );
    }
  }

  #toRequestContext(
    ctx: ServerContext
  ): RequestContext<TUser, HasOAuth<TUser>, TEnv> {
    if (this.#config.oauth === undefined) {
      return toRequestContext<TEnv>(ctx) as RequestContext<
        TUser,
        HasOAuth<TUser>,
        TEnv
      >;
    }
    return toAuthenticatedRequestContext<TUser, TEnv>(ctx) as RequestContext<
      TUser,
      HasOAuth<TUser>,
      TEnv
    >;
  }
}
