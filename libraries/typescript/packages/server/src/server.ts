import { serve, type ServerType } from "@hono/node-server";
import {
  hostHeaderValidation,
  originValidation,
} from "@modelcontextprotocol/hono";
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer as SdkMcpServer,
  ResourceTemplate,
  type AuthInfo,
  type McpHttpHandler,
  type McpRequestContext,
  type PromptCallback as SdkPromptCallback,
  type ServerEventBus,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { Hono, type Env } from "hono";

import { assertServerConfig, type ServerConfig } from "./config.js";
import {
  toAuthenticatedRequestContext,
  toRequestContext,
  type RequestContext,
} from "./context.js";
import { mountInspectorShell } from "./inspector-shell.js";
import { requestLogger } from "./logging.js";
import { mountMcp } from "./mount-mcp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
} from "./oauth/index.js";
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
  mountViewRoutes,
  registerViews,
  resolveRequestOrigin,
  synthesizeViewDocument,
  viewResourceConfig,
  viewResourceUri,
  buildResourceUiMeta,
  buildToolResultUiMeta,
  buildToolUiMeta,
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

/**
 * The per-request Hono variable used to carry verified identity through the
 * MCP adapter.
 *
 * `createMcpHonoApp` currently returns an unparameterized `Hono`, so this is
 * the narrow type boundary that describes the variable added by this class.
 */
interface OAuthHonoEnv extends Env {
  Variables: {
    authInfo?: AuthInfo;
  };
}

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

/**
 * MCP server with declarative tool/resource/prompt registration, served
 * statelessly over Hono.
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

  #app: Hono | undefined;
  #handler: McpHttpHandler | undefined;
  #httpServer: ServerType | undefined;
  #oauthResource: URL | undefined;
  #oauthResourceResolved = false;
  #oauthResourceConfigurationAbsent = false;
  /** Whether the mounted app validates Host headers (fixed at first mount). */
  #hostValidated = false;

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
  getHandler(
    options: { bus?: ServerEventBus } = {}
  ): (request: Request) => Promise<Response> {
    const { app } = this.#ensureMounted("handler", undefined, options.bus);
    return async (request) => app.fetch(request);
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
    return new Promise((resolve, reject) => {
      let resolveApp: ((app: Hono) => void) | undefined;
      let rejectApp: ((error: unknown) => void) | undefined;
      const appReady = new Promise<Hono>(
        (resolveAppPromise, rejectAppPromise) => {
          resolveApp = resolveAppPromise;
          rejectApp = rejectAppPromise;
        }
      );
      // A failed mount rejects pending requests; when none arrived, consume
      // that rejection here so a configuration error is reported only through
      // the listen() promise.
      void appReady.catch(() => undefined);
      let settled = false;
      const rejectAndClose = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        rejectApp?.(error);
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
      const server = serve(
        {
          // The listener can accept before its callback runs. Queue those
          // requests until mounting completes instead of failing normal startup.
          fetch: async (request) => (await appReady).fetch(request),
          port,
          hostname: this.#config.host ?? "127.0.0.1",
        },
        (info) => {
          try {
            const { app } = this.#ensureMounted("listen", info.port);
            resolveApp?.(app);
            if (!settled) {
              settled = true;
              resolve({
                port: info.port,
                url: `http://localhost:${info.port}${this.#basePath()}`,
              });
            }
          } catch (error) {
            rejectAndClose(error);
          }
        }
      );
      this.#httpServer = server;
      server.once("error", rejectAndClose);
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
    app: Hono;
    handler: McpHttpHandler;
  } {
    if (this.#app === undefined || this.#handler === undefined) {
      const { hosts, origins } = this.#validationPolicy(mode);
      const app = new Hono();
      // JSON body parsing (same semantics as createMcpHonoApp): stash parsed
      // bodies in context vars for mountMcp and requestLogger.
      app.use("*", async (c, next) => {
        if ((c.var as Record<string, unknown>)["parsedBody"] !== undefined) {
          return await next();
        }
        if (
          !(c.req.header("content-type") ?? "").includes("application/json")
        ) {
          return await next();
        }
        try {
          const parsed: unknown = await c.req.raw.clone().json();
          // c.var is a read-only snapshot; c.set is the write path (untyped
          // here because the app runs on Hono's default Env).
          (c.set as (key: string, value: unknown) => void)(
            "parsedBody",
            parsed
          );
        } catch {
          return c.text("Invalid JSON", 400);
        }
        return await next();
      });
      if (hosts !== undefined) {
        app.use("*", hostHeaderValidation(hosts));
        // Origin on side-effect methods only: sandboxed view iframes send
        // `Origin: null` on asset GETs; external hosts fetch with their own
        // origins. The MCP wire is POST; read rebinding is covered by Host.
        app.use("*", async (c, next) => {
          if (c.req.method === "GET" || c.req.method === "HEAD") {
            return await next();
          }
          const validate = originValidation(origins ?? hosts);
          return validate(
            c as Parameters<typeof validate>[0],
            next as Parameters<typeof validate>[1]
          );
        });
      } else {
        // Host validation off: the SDK handler parses JSON itself when
        // parsedBody is absent (see mountMcp).
        if (origins !== undefined) {
          app.use("*", async (c, next) => {
            if (c.req.method === "GET" || c.req.method === "HEAD") {
              return await next();
            }
            const validate = originValidation(origins);
            return validate(
              c as Parameters<typeof validate>[0],
              next as Parameters<typeof validate>[1]
            );
          });
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
      // Logging first so view document/asset routes are observed too.
      app.use("*", requestLogger(this.#config.logging));
      this.#validateViewBindingsAtMount();
      mountViewRoutes(app, this.#basePath(), this.#views, {
        dev: this.#viewsDevMode,
        projectRoot: this.#viewsProjectRoot,
      });
      // The official adapter returns an unparameterized Hono app. Its
      // runtime Context supports request-scoped variables, so narrow the
      // type only at the OAuth composition seam we own.
      const mcpApp = app as unknown as Hono<OAuthHonoEnv>;
      const resource = this.#resolveOAuthResource(mode, listenPort);
      if (resource !== undefined) {
        const provider = this.#config.oauth!;
        const providerOptions = getOAuthProviderOptions(provider);
        app.use("*", async (c, next) => {
          const response = oauthMetadataResponse(c.req.raw, {
            oauthMetadata: providerOptions.oauthMetadata,
            resourceServerUrl: resource,
            ...(providerOptions.scopesSupported !== undefined && {
              scopesSupported: providerOptions.scopesSupported,
            }),
            ...(providerOptions.resourceName !== undefined && {
              resourceName: providerOptions.resourceName,
            }),
            ...(providerOptions.serviceDocumentationUrl !== undefined && {
              serviceDocumentationUrl: providerOptions.serviceDocumentationUrl,
            }),
          });
          if (response !== undefined) {
            return response;
          }
          await next();
        });

        const gate = requireBearerAuth({
          verifier: wrapOAuthTokenVerifier(provider, resource),
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
          ...(providerOptions.requiredScopes !== undefined && {
            requiredScopes: providerOptions.requiredScopes,
          }),
        });
        mcpApp.use(this.#basePath(), async (c, next) => {
          const result = await gate(c.req.raw);
          if (result instanceof Response) {
            return result;
          }
          c.set("authInfo", result);
          await next();
        });
      }
      const handler = mountMcp(mcpApp, (ctx) => this.#buildSdkServer(ctx), {
        path: this.#basePath(),
        ...((this.#config.legacy !== undefined || bus !== undefined) && {
          handler: {
            ...(this.#config.legacy !== undefined && {
              legacy: this.#config.legacy,
            }),
            ...(bus !== undefined && { bus }),
          },
        }),
        ...(resource !== undefined && {
          authInfo: (context) => context.get("authInfo"),
        }),
      });
      // Inspector shell (default enabled, FastAPI /docs style) rides the
      // same app, so the validation middleware above covers it too.
      mountInspectorShell(app, this.#config.inspector, {
        serverName: this.#config.name,
        basePath: this.#basePath(),
      });
      this.#app = app;
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
      // getHandler() mounted without Host validation; a localhost listen()
      // on that app would silently lose DNS-rebinding protection.
      throw new Error(
        "Cannot listen() on a localhost bind after getHandler(): the app is " +
          "already mounted without Host validation (getHandler() expects a " +
          "platform edge in front). Call listen() first, or set allowedHosts."
      );
    }
    return { app: this.#app, handler: this.#handler };
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
      },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
        },
        ...(instructions !== undefined && { instructions }),
        ...(authInfo !== undefined && { authInfo }),
      }
    );

    const request = ctx.requestInfo;
    const servingOrigin =
      request !== undefined ? resolveRequestOrigin(request) : "";
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
        servingOrigin,
        basePath
      );
    }
    return server;
  }

  #registerTool(
    server: SdkMcpServer,
    { definition, callback }: ToolEntry<TUser>
  ): void {
    const view = definition.view;

    const toolUiMeta = buildToolUiMeta(view?.name, definition.visibility);
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
      ...(toolUiMeta !== undefined && { _meta: toolUiMeta }),
    };
    const wireResultMeta =
      view !== undefined ? buildToolResultUiMeta(view.name) : undefined;

    const inputSchema = resolveToolInputSchema(definition);

    if (inputSchema !== undefined) {
      server.registerTool(
        definition.name,
        { ...config, inputSchema },
        async (args, ctx) => {
          // The SDK has already validated `args` against the input schema.
          const params = args as Record<string, unknown>;
          const result = await callback(params, this.#toRequestContext(ctx));
          if (wireResultMeta === undefined || result.isError === true) {
            return result;
          }
          return {
            ...result,
            _meta: { ...result._meta, ...wireResultMeta },
          };
        }
      );
    } else {
      server.registerTool(definition.name, config, async (ctx) => {
        const result = await callback({}, this.#toRequestContext(ctx));
        if (wireResultMeta === undefined || result.isError === true) {
          return result;
        }
        return {
          ...result,
          _meta: { ...result._meta, ...wireResultMeta },
        };
      });
    }
  }

  #registerViewResource(
    server: SdkMcpServer,
    viewName: string,
    entry: ViewManifestEntry,
    servingOrigin: string,
    basePath: string
  ): void {
    const uri = viewResourceUri(viewName);
    const authorFacts = this.#viewResourceFacts(
      this.#viewBindings.get(viewName)?.config
    );
    const hmrWs = this.#viewsDevMode;
    const resourceConfig = viewResourceConfig(
      viewName,
      entry,
      authorFacts,
      servingOrigin,
      { hmrWs }
    );
    server.registerResource(
      viewName,
      uri,
      resourceConfig,
      async (readUri, ctx) => {
        const req = ctx.http?.req;
        const origin =
          req !== undefined ? resolveRequestOrigin(req) : servingOrigin;
        const html = synthesizeViewDocument(entry, origin, basePath);
        return {
          contents: [
            {
              uri: readUri.href,
              mimeType: resourceConfig.mimeType,
              text: html,
              _meta: buildResourceUiMeta(authorFacts, origin, { hmrWs }),
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
      },
      async (uri, ctx) => callback(uri, this.#toRequestContext(ctx))
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
      },
      async (uri, variables, ctx) =>
        callback(
          uri,
          variables as Record<string, TemplateVariableValue>,
          this.#toRequestContext(ctx)
        )
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
    if (definition.schema !== undefined) {
      server.registerPrompt(
        definition.name,
        { ...config, argsSchema: definition.schema },
        async (args, ctx) => {
          // The SDK has already validated `args` against `definition.schema`.
          const params = args as Record<string, unknown>;
          return callback(params, this.#toRequestContext(ctx));
        }
      );
    } else {
      // Without argsSchema the SDK invokes the callback as `(ctx)`, but its
      // published overloads only type the `(args, ctx)` shape — adapt with an
      // explicit, contained cast (verified against the SDK's
      // createPromptHandler implementation, 2.0.0-beta.1).
      const handler = async (ctx: ServerContext) =>
        callback({}, this.#toRequestContext(ctx));
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
