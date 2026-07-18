import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer as SdkMcpServer,
  ResourceTemplate,
  isInputRequiredResult,
  type McpHttpHandler,
  type McpRequestContext,
  type PromptCallback as SdkPromptCallback,
  type ServerEventBus,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Server as NodeHttpServer } from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/server";

import {
  createFaviconHandler,
  hasLocalBrandingAsset,
  normalizeServerBranding,
  resolveImplementationIcons,
  type ServerBranding,
} from "./branding.js";
import { assertServerConfig, type ServerConfig } from "./config.js";
import {
  toAuthenticatedRequestContext,
  toRequestContext,
  type RequestContext,
} from "./context.js";
import {
  composeFetch,
  getRequestBag,
  hostValidationMiddleware,
  isHtmlNavigationRequest,
  jsonBodyMiddleware,
  matchesPath,
  originValidationMiddleware,
  routeFetch,
  toFrameworkHandler,
  type FetchHandler,
  type FrameworkHandler,
} from "./fetch-app.js";
import { corsFetchMiddleware, isGlobalCorsEnabled } from "./middleware/cors.js";
import {
  normalizeMcpMiddlewarePattern,
  parseMcpPattern,
  runMcpOperation,
  type McpCompleteEventListenerFn,
  type McpEventListenerEntry,
  type McpEventListenerFn,
  type McpMiddlewareEntry,
  type McpMiddlewareFn,
  type McpMiddlewareFnFor,
  type MiddlewareContext,
} from "./middleware/mcp-middleware.js";
import {
  createInspectorHandler,
  matchesInspectorShellPath,
} from "./inspector-shell.js";
import { requestLogger } from "./logging.js";
import { createMcpMount } from "./mount-mcp.js";
import type { NodeRequestHandler } from "./node-bridge.js";
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
  InferToolInput,
  InferToolName,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
  ToolRef,
  ToolViewConfig,
} from "./tools.js";
import { resolveToolInputSchema } from "./tools.js";
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

/** Type-erased registry entry replayed when a per-request SDK server is built. */
interface ToolEntry<TUser> {
  /** Declarative tool metadata and schemas supplied at registration time. */
  definition: ToolDefinition;
  /** Tool callback widened for heterogeneous storage in the registry. */
  callback: ToolCallback<
    Record<string, unknown>,
    never,
    TUser,
    HasOAuth<TUser>
  >;
}

/** Static resource definition and callback retained for per-request replay. */
interface ResourceEntry<TUser> {
  /** Declarative resource metadata supplied at registration time. */
  definition: ResourceDefinition;
  /** Callback invoked when the registered resource URI is read. */
  callback: ResourceCallback<TUser, HasOAuth<TUser>>;
}

/** Parameterized resource definition and type-erased callback registry entry. */
interface ResourceTemplateEntry<TUser> {
  /** Declarative template metadata, including its URI template. */
  definition: ResourceTemplateDefinition;
  /** Template callback widened to store every inferred variable shape. */
  callback: ResourceTemplateCallback<
    Record<string, TemplateVariableValue>,
    TUser,
    HasOAuth<TUser>
  >;
}

/** Prompt definition and type-erased callback retained for request-time replay. */
interface PromptEntry<TUser> {
  /** Declarative prompt metadata and optional argument schema. */
  definition: PromptDefinition;
  /** Prompt callback widened to store every inferred argument shape. */
  callback: PromptCallback<Record<string, unknown>, TUser, HasOAuth<TUser>>;
}

/** Node HTTP listener returned by `listen()`. */
interface NodeHttpListener {
  close(callback?: (error?: Error) => void): void;
  once(event: "error", listener: (error: unknown) => void): void;
  listen(port: number, hostname: string, callback?: () => void): NodeHttpServer;
  address(): { port: number } | string | null;
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
export class MCPServer<TUser = never> {
  readonly #config: ServerConfig<TUser>;
  readonly #branding: ReturnType<typeof normalizeServerBranding>;
  readonly #tools = new Map<string, ToolEntry<TUser>>();
  readonly #resources = new Map<string, ResourceEntry<TUser>>();
  readonly #resourceTemplates = new Map<string, ResourceTemplateEntry<TUser>>();
  readonly #prompts = new Map<string, PromptEntry<TUser>>();
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
  /** Project root for filesystem-backed view routes (dev `public/`). */
  #viewsProjectRoot = process.cwd();

  #fetchHandler: FetchHandler | undefined;
  #handler: McpHttpHandler | undefined;
  #httpServer: NodeHttpListener | undefined;
  #oauthResource: URL | undefined;
  #oauthResourceResolved = false;
  #oauthResourceConfigurationAbsent = false;
  /** Whether the mounted app validates Host headers (fixed at first mount). */
  #hostValidated = false;
  readonly #mcpMiddlewares: McpMiddlewareEntry[] = [];
  readonly #mcpEventListeners: McpEventListenerEntry[] = [];

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
    return server;
  }

  /**
   * Create a server. `config.name` and `config.version` identify the server
   * to clients during initialization. `config.basePath` (default `"/mcp"`)
   * is both the MCP route and the path of the OAuth protected-resource
   * identity, so any explicit OAuth resource URL must use that exact path.
   * Nothing binds or listens until {@link MCPServer.listen} or
   * {@link MCPServer.getHandler} is called.
   */
  constructor(config: ServerConfig<TUser>) {
    assertServerConfig(config);
    this.#config = config;
    this.#branding = normalizeServerBranding(config);
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
   * can build the endpoint and inspector URLs without assuming the default.
   */
  get basePath(): string {
    return this.#basePath();
  }

  /**
   * Immutable normalized branding shared by MCP identity and browser pages.
   *
   * `favicon` is the final source after explicit-favicon and icon-selection
   * precedence. Landing-page integrations can use this accessor and link to
   * the server's root-level `/favicon.ico` route without reading private
   * configuration or depending on the inspector/view layers.
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

  /**
   * Register a tool. Input is validated against `inputSchema` before the callback
   * runs; results carrying `structuredContent` are type-checked against
   * `outputSchema` at the callback's return position.
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
      HasOAuth<TUser>
    >
  ): ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>> {
    this.#assertNotStarted("tool", definition.name);
    this.#validateToolViewBinding(definition);
    this.#tools.set(definition.name, {
      definition,
      callback: callback as ToolCallback<
        Record<string, unknown>,
        never,
        TUser,
        HasOAuth<TUser>
      >,
    });
    return Object.freeze({
      name: definition.name,
    }) as ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>>;
  }

  /**
   * Prime the views registry from a build/dev manifest.
   *
   * @param views - Manifest map keyed by view directory name.
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
    callback: ResourceCallback<TUser, HasOAuth<TUser>>
  ): this {
    this.#assertNotStarted("resource", definition.name);
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
  resourceTemplate<const T extends ResourceTemplateDefinition>(
    definition: T,
    callback: ResourceTemplateCallback<
      InferTemplateParams<T>,
      TUser,
      HasOAuth<TUser>
    >
  ): this {
    this.#assertNotStarted("resourceTemplate", definition.name);
    this.#resourceTemplates.set(definition.name, {
      definition,
      callback: callback as ResourceTemplateCallback<
        Record<string, TemplateVariableValue>,
        TUser,
        HasOAuth<TUser>
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
    callback: PromptCallback<InferPromptInput<T>, TUser, HasOAuth<TUser>>
  ): this {
    this.#assertNotStarted("prompt", definition.name);
    this.#prompts.set(definition.name, {
      definition,
      callback: callback as PromptCallback<
        Record<string, unknown>,
        TUser,
        HasOAuth<TUser>
      >,
    });
    return this;
  }

  /**
   * Web-standard request handler for the whole app (MCP endpoint included) —
   * usable directly on serverless/edge runtimes or in tests.
   *
   * The handler never binds a socket, so no Host/Origin validation applies
   * by default: DNS rebinding targets locally bound servers, and platform
   * edges (Vercel, Cloudflare, …) only route hostnames assigned to the
   * deployment. Set `allowedHosts`/`allowedOrigins` to opt into validation
   * (additive — localhost-class values stay allowed).
   *
   * Pass the same `bus` to multiple server instances when their handlers
   * replace one another while existing `subscriptions/listen` streams remain
   * open. The bus is fixed when this instance first mounts.
   *
   * @param options - Optional handler wiring.
   *
   * @example
   * ```ts
   * const handler = server.getHandler();
   * export default { fetch: handler };
   * ```
   */
  getHandler(options: { bus?: ServerEventBus } = {}): FrameworkHandler {
    const { fetch } = this.#ensureMounted("handler", undefined, options.bus);
    return toFrameworkHandler(fetch);
  }

  /**
   * Node `(req, res) => void` handler for composing with an existing
   * `http.Server`. Uses the same internal `toNodeHandler` bridge as
   * {@link MCPServer.listen}; MCPServer users do not need to import
   * `mcp-use/node`.
   *
   * @example
   * ```ts
   * import { createServer } from "node:http";
   * const httpServer = createServer(await server.getNodeHandler());
   * httpServer.listen(3000);
   * ```
   */
  async getNodeHandler(): Promise<NodeRequestHandler> {
    const { fetch } = this.#ensureMounted("handler");
    const { toNodeHandler } = await import("./node-bridge.js");
    return toNodeHandler({ fetch });
  }

  /**
   * Register MCP operation middleware that intercepts JSON-RPC dispatch.
   *
   * Patterns use an `mcp:` prefix (for example `mcp:tools/call`, `mcp:*`).
   * Middleware runs in registration order; call `next()` to continue the chain.
   *
   * @example
   * ```ts
   * server.use("mcp:tools/call", async (ctx, next) => {
   *   console.log(`Calling tool: ${ctx.params.name}`);
   *   return next();
   * });
   * ```
   */
  use<P extends string>(
    pattern: `mcp:${P}` | P,
    handler: McpMiddlewareFnFor<P>
  ): this {
    this.#assertNotStarted("middleware", pattern);
    this.#mcpMiddlewares.push({
      pattern: normalizeMcpMiddlewarePattern(pattern),
      handler: handler as McpMiddlewareFn,
    });
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
  on<P extends string>(
    pattern: `mcp:${P}` | P,
    handler: P extends `${string}:complete`
      ? McpCompleteEventListenerFn
      : McpEventListenerFn
  ): this {
    this.#assertNotStarted("event listener", pattern);
    const { pattern: stripped, phase } = parseMcpPattern(pattern);
    this.#mcpEventListeners.push({
      pattern: stripped,
      phase,
      handler: handler as McpEventListenerFn | McpCompleteEventListenerFn,
    });
    return this;
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
   * Serve over HTTP on Node. Pass port `0` for an ephemeral port.
   *
   * Binds `config.host` (default `127.0.0.1`). Localhost-class binds get
   * DNS-rebinding protection automatically: `Host` on every request,
   * `Origin` only on non-GET/HEAD (sandboxed view iframes send
   * `Origin: null` on asset GETs). To serve publicly set `host: "0.0.0.0"`;
   * behind a platform edge that is all that's needed, and `allowedHosts`
   * restricts direct exposure (additive — localhost-class values stay allowed).
   *
   * With OAuth and no explicit resource or `MCP_URL`, a localhost listener
   * derives its protected-resource URL from the actual bound port. Mounting
   * therefore waits for the listener callback (especially for port `0`), and
   * requests accepted before then are queued. Public/wildcard listeners must
   * configure the resource before calling this method.
   *
   * @throws If called on a localhost-class bind after {@link MCPServer.getHandler}
   * already mounted the app without Host validation.
   */
  async listen(port = 3000): Promise<{ port: number; url: string }> {
    this.#assertListenOAuthConfiguration();
    const { createServer } = await import("node:http");
    const { toNodeHandler } = await import("./node-bridge.js");
    const host = this.#config.host ?? "127.0.0.1";

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
      const server = createServer((req, res) => {
        void nodeHandler(req, res);
      }) as NodeHttpListener;

      server.once("error", rejectAndClose);
      server.listen(port, host, () => {
        try {
          const address = server.address();
          const boundPort =
            typeof address === "object" && address !== null
              ? address.port
              : port;
          const { fetch } = this.#ensureMounted("listen", boundPort);
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
   * closed, so `listen()`/`getHandler()` cannot revive it. Create a new
   * instance to serve again.
   */
  async close(): Promise<void> {
    await this.#handler?.close();
    const httpServer = this.#httpServer;
    if (httpServer !== undefined) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      this.#httpServer = undefined;
    }
  }

  #basePath(): string {
    return this.#config.basePath ?? "/mcp";
  }

  #resolveOAuthResource(
    mode: "listen" | "handler",
    listenPort?: number
  ): URL | undefined {
    if (this.#config.oauth === undefined) {
      return undefined;
    }
    if (this.#oauthResourceResolved) {
      return this.#oauthResource;
    }

    const host = this.#config.host ?? "127.0.0.1";
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
      "OAuth requires an explicit resource or MCP_URL when using getHandler() or listening on a non-local host"
    );
  }

  #assertListenOAuthConfiguration(): void {
    if (this.#config.oauth === undefined) {
      return;
    }
    const host = this.#config.host ?? "127.0.0.1";
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
          `so register everything before listen()/getHandler().`
      );
    }
  }

  /**
   * Effective Host/Origin allowlists for a mount mode; `undefined` means the
   * corresponding validation is off.
   *
   * Configured lists are additive to the localhost-class allowlists, so local
   * runs keep working when a deployment hostname is added. With nothing
   * configured, `listen()` on a localhost-class bind validates against the
   * localhost lists (the DNS-rebinding threat model), while `getHandler()` —
   * which never binds — applies no validation. `allowedOrigins` defaults to
   * mirroring the effective Host allowlist. Origin validation runs only on
   * non-GET/HEAD requests.
   */
  #validationPolicy(mode: "listen" | "handler"): {
    hosts: string[] | undefined;
    origins: string[] | undefined;
  } {
    const { host = "127.0.0.1", allowedHosts, allowedOrigins } = this.#config;
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
        : hosts;
    return { hosts, origins };
  }

  #ensureMounted(
    mode: "listen" | "handler",
    listenPort?: number,
    bus?: ServerEventBus
  ): {
    fetch: FetchHandler;
    handler: McpHttpHandler;
  } {
    if (this.#fetchHandler === undefined || this.#handler === undefined) {
      const { hosts, origins } = this.#validationPolicy(mode);
      const basePath = this.#basePath();
      const nestedBasePath = basePath === "/" ? "" : basePath;
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
        middlewares.push(originValidationMiddleware(origins ?? hosts));
      } else {
        if (origins !== undefined) {
          middlewares.push(originValidationMiddleware(origins));
        }
        if (mode === "listen") {
          console.warn(
            `[mcp-use] listen() is serving on ${this.#config.host} without ` +
              `Host validation. Behind a platform edge that only routes your ` +
              `own domains this is expected; if this process is reachable ` +
              `directly, set allowedHosts to restrict it.`
          );
        }
      }

      this.#validateViewBindingsAtMount();

      const resource = this.#resolveOAuthResource(mode, listenPort);
      if (resource !== undefined) {
        const provider = this.#config.oauth!;
        middlewares.push(oauthMetadata(provider, resource));
      }

      const { handler, fetch: mcpFetch } = createMcpMount(
        (ctx) => this.#buildSdkServer(ctx),
        {
          path: basePath,
          ...((this.#config.legacy !== undefined || bus !== undefined) && {
            handler: {
              ...(this.#config.legacy !== undefined && {
                legacy: this.#config.legacy,
              }),
              ...(bus !== undefined && { bus }),
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
      }

      const mcpRouteHandler: FetchHandler = (request) =>
        protectWithBearer(request, () => mcpFetch(request));
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
        if (resource !== undefined && this.#config.publicLandingPage !== true) {
          return protectWithBearer(request, respond);
        }
        return respond();
      };

      const routes: Array<{
        match: (request: Request) => boolean;
        handler: FetchHandler;
      }> = [];

      const brandingDevMode = this.#viewsPrimed
        ? this.#viewsDevMode
        : process.env["NODE_ENV"] !== "production";
      const faviconHandler = createFaviconHandler(this.#branding, {
        dev: brandingDevMode,
        projectRoot: this.#viewsProjectRoot,
        deferCors: deferViewCors,
      });
      if (faviconHandler !== undefined) {
        routes.push({
          match: (request) => new URL(request.url).pathname === "/favicon.ico",
          handler: faviconHandler,
        });
      }

      const viewHandler = createViewPublicHandler(basePath, this.#views, {
        dev: this.#viewsPrimed ? this.#viewsDevMode : brandingDevMode,
        projectRoot: this.#viewsProjectRoot,
        enabled: hasLocalBrandingAsset(this.#branding),
        deferCors: deferViewCors,
      });
      if (viewHandler !== undefined) {
        routes.push({
          match: (request) =>
            request.method === "GET" || request.method === "HEAD"
              ? new URL(request.url).pathname.startsWith(
                  `${nestedBasePath}/_mcp-use/public/`
                )
              : false,
          handler: viewHandler,
        });
      }

      if (!this.#viewsDevMode) {
        const viewAssetsHandler = createViewAssetsHandler(
          basePath,
          this.#views,
          { projectRoot: this.#viewsProjectRoot, deferCors: deferViewCors }
        );
        if (viewAssetsHandler !== undefined) {
          routes.push({
            match: (request) =>
              request.method === "GET" || request.method === "HEAD"
                ? new URL(request.url).pathname.startsWith(
                    `${nestedBasePath}/_mcp-use/views/`
                  )
                : false,
            handler: viewAssetsHandler,
          });
        }
      }

      const inspectorHandler = createInspectorHandler(this.#config.inspector, {
        serverName: this.#config.name,
        basePath,
        ...(faviconHandler !== undefined && { faviconHref: "/favicon.ico" }),
      });
      if (inspectorHandler !== undefined) {
        routes.push({
          match: (request) => {
            if (request.method !== "GET" && request.method !== "HEAD") {
              return false;
            }
            const pathname = new URL(request.url).pathname;
            return matchesInspectorShellPath(pathname, basePath);
          },
          handler: inspectorHandler,
        });
      }

      routes.push({
        match: (request) => matchesPath(request, basePath),
        handler: endpointHandler,
      });

      const terminal = routeFetch(routes);
      this.#fetchHandler = composeFetch(terminal, ...middlewares);
      this.#handler = handler;
      this.#hostValidated = hosts !== undefined;
    } else if (bus !== undefined && this.#handler.bus !== bus) {
      throw new Error(
        "Cannot change the MCP event bus after the server has started."
      );
    } else if (
      mode === "listen" &&
      !this.#hostValidated &&
      this.#validationPolicy("listen").hosts !== undefined
    ) {
      throw new Error(
        "Cannot listen() on a localhost bind after getHandler(): the app is " +
          "already mounted without Host validation (getHandler() expects a " +
          "platform edge in front). Call listen() first, or set allowedHosts."
      );
    }
    return { fetch: this.#fetchHandler, handler: this.#handler };
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

  /** Build a fresh SDK server from the registry (runs once per request). */
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

  #createMiddlewareContext(
    method: string,
    params: Record<string, unknown>,
    ctx: ServerContext
  ): MiddlewareContext {
    return {
      method,
      params,
      ...(ctx.http?.authInfo !== undefined && { auth: ctx.http.authInfo }),
      state: new Map(),
    };
  }

  #runMcpHook(
    method: string,
    ctx: MiddlewareContext,
    innerFn: () => Promise<unknown>
  ): Promise<unknown> {
    return runMcpOperation(
      this.#mcpMiddlewares,
      this.#mcpEventListeners,
      method,
      ctx,
      innerFn
    );
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

    const wrapListMethod = (
      method: "tools/list" | "resources/list" | "prompts/list",
      resultKey: "tools" | "resources" | "prompts"
    ) => {
      const original = handlers.get(method);
      if (original === undefined) {
        return;
      }
      if ((original as { __mcpListWrapped?: boolean }).__mcpListWrapped) {
        return;
      }

      const wrapped = async (request: unknown, extra: unknown) => {
        const authInfo = (
          extra as { http?: { authInfo?: AuthInfo } } | undefined
        )?.http?.authInfo;
        const mwCtx: MiddlewareContext = {
          method,
          params: {},
          ...(authInfo !== undefined && { auth: authInfo }),
          state: new Map(),
        };
        const innerFn = async () => {
          const result = (await original(request, extra)) as Record<
            string,
            unknown
          >;
          return result[resultKey] ?? result;
        };
        const filtered = await this.#runMcpHook(method, mwCtx, innerFn);
        if (Array.isArray(filtered)) {
          return { [resultKey]: filtered };
        }
        return filtered;
      };
      (wrapped as { __mcpListWrapped?: boolean }).__mcpListWrapped = true;
      handlers.set(method, wrapped);
    };

    wrapListMethod("tools/list", "tools");
    wrapListMethod("resources/list", "resources");
    wrapListMethod("prompts/list", "prompts");
  }

  #registerTool(
    server: SdkMcpServer,
    { definition, callback }: ToolEntry<TUser>
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
        { name: definition.name, arguments: args },
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
    { definition, callback }: ResourceEntry<TUser>
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
          { uri: uri.href },
          ctx
        );
        const innerFn = async () => callback(uri, this.#toRequestContext(ctx));
        return (await this.#runMcpHook(
          "resources/read",
          mwCtx,
          innerFn
        )) as Awaited<ReturnType<typeof callback>>;
      }
    );
  }

  #registerResourceTemplate(
    server: SdkMcpServer,
    { definition, callback }: ResourceTemplateEntry<TUser>
  ): void {
    const template = new ResourceTemplate(definition.uriTemplate, {
      list: undefined,
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
          { uri: uri.href },
          ctx
        );
        const innerFn = async () =>
          callback(
            uri,
            variables as Record<string, TemplateVariableValue>,
            this.#toRequestContext(ctx)
          );
        return (await this.#runMcpHook(
          "resources/read",
          mwCtx,
          innerFn
        )) as Awaited<ReturnType<typeof callback>>;
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
    { definition, callback }: PromptEntry<TUser>
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
        { name: definition.name, arguments: args as Record<string, string> },
        ctx
      );
      const innerFn = async () => {
        const effectiveArgs = (mwCtx.params.arguments ?? {}) as Record<
          string,
          unknown
        >;
        return callback(effectiveArgs, this.#toRequestContext(ctx));
      };
      return (await this.#runMcpHook("prompts/get", mwCtx, innerFn)) as Awaited<
        ReturnType<typeof callback>
      >;
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
  ): RequestContext<TUser, HasOAuth<TUser>> {
    if (this.#config.oauth === undefined) {
      return toRequestContext(ctx) as RequestContext<TUser, HasOAuth<TUser>>;
    }
    return toAuthenticatedRequestContext<TUser>(ctx) as RequestContext<
      TUser,
      HasOAuth<TUser>
    >;
  }
}
