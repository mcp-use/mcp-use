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
  type McpHttpHandler,
  type McpRequestContext,
  type PromptCallback as SdkPromptCallback,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { ServerConfig } from "./config.js";
import { toRequestContext } from "./context.js";
import { mountInspectorShell } from "./inspector-shell.js";
import { requestLogger } from "./logging.js";
import { mountMcp } from "./mount-mcp.js";
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
interface ToolEntry {
  definition: ToolDefinition;
  callback: ToolCallback;
}

interface ResourceEntry {
  definition: ResourceDefinition;
  callback: ResourceCallback;
}

interface ResourceTemplateEntry {
  definition: ResourceTemplateDefinition;
  callback: ResourceTemplateCallback;
}

interface PromptEntry {
  definition: PromptDefinition;
  callback: PromptCallback;
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
 *   { name: "add", schema: z.object({ a: z.number(), b: z.number() }) },
 *   async ({ a, b }) => ({
 *     content: [{ type: "text", text: String(a + b) }],
 *   })
 * );
 * await server.listen(3000);
 * ```
 */
export class MCPServer {
  readonly #config: ServerConfig;
  readonly #tools = new Map<string, ToolEntry>();
  readonly #resources = new Map<string, ResourceEntry>();
  readonly #resourceTemplates = new Map<string, ResourceTemplateEntry>();
  readonly #prompts = new Map<string, PromptEntry>();
  readonly #views = new Map<string, ViewManifestEntry>();
  readonly #viewBindings = new Map<
    string,
    { toolName: string; config: NonNullable<ToolDefinition["view"]> }
  >();
  #viewsPrimed = false;
  /** When true, resource CSP emission includes the HMR websocket origin. */
  #viewsDevMode = false;
  /** Project root for filesystem-backed view routes (dev `public/`). */
  #viewsProjectRoot = process.cwd();

  #app: Hono | undefined;
  #handler: McpHttpHandler | undefined;
  #httpServer: ServerType | undefined;
  /** Whether the mounted app validates Host headers (fixed at first mount). */
  #hostValidated = false;

  /**
   * Create a server. `config.name` and `config.version` identify the server
   * to clients during initialization; nothing binds or listens until
   * {@link MCPServer.listen} or {@link MCPServer.getHandler} is called.
   */
  constructor(config: ServerConfig) {
    this.#config = config;
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
   * Register a tool. Input is validated against `schema` before the callback
   * runs; results carrying `structuredContent` are type-checked against
   * `outputSchema` at the callback's return position.
   *
   * @returns A {@link ToolRef} carrying the tool name and phantom types for
   * inference-based view typing.
   */
  tool<const T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>>
  ): ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>> {
    this.#assertNotStarted("tool", definition.name);
    this.#validateToolViewBinding(definition);
    this.#tools.set(definition.name, {
      definition,
      callback: callback as ToolCallback,
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
  __primeViews(views: ViewsManifest, options?: { dev?: boolean; projectRoot?: string }): void {
    this[registerViews](views, options);
  }

  /** Register a static resource readable at `definition.uri`. */
  resource(definition: ResourceDefinition, callback: ResourceCallback): this {
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
    callback: ResourceTemplateCallback<InferTemplateParams<T>>
  ): this {
    this.#assertNotStarted("resourceTemplate", definition.name);
    this.#resourceTemplates.set(definition.name, {
      definition,
      callback: callback as ResourceTemplateCallback,
    });
    return this;
  }

  /**
   * Register a prompt template. Schema fields wrapped with `completable()`
   * gain autocomplete via `completion/complete`.
   */
  prompt<T extends PromptDefinition>(
    definition: T,
    callback: PromptCallback<InferPromptInput<T>>
  ): this {
    this.#assertNotStarted("prompt", definition.name);
    this.#prompts.set(definition.name, {
      definition,
      callback: callback as PromptCallback,
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
   */
  getHandler(): (request: Request) => Promise<Response> {
    const { app } = this.#ensureMounted("handler");
    return async (request) => app.fetch(request);
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
   * @throws If called on a localhost-class bind after {@link MCPServer.getHandler}
   * already mounted the app without Host validation.
   */
  async listen(port = 3000): Promise<{ port: number; url: string }> {
    const { app } = this.#ensureMounted("listen");
    return new Promise((resolve, reject) => {
      const server = serve(
        { fetch: app.fetch, port, hostname: this.#config.host ?? "127.0.0.1" },
        (info) => {
          resolve({
            port: info.port,
            url: `http://localhost:${info.port}${this.#basePath()}`,
          });
        }
      );
      this.#httpServer = server;
      server.once("error", reject);
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

  #ensureMounted(mode: "listen" | "handler"): {
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
        if (!(c.req.header("content-type") ?? "").includes("application/json")) {
          return await next();
        }
        try {
          const parsed: unknown = await c.req.raw.clone().json();
          // c.var is a read-only snapshot; c.set is the write path (untyped
          // here because the app runs on Hono's default Env).
          (c.set as (key: string, value: unknown) => void)("parsedBody", parsed);
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
          return originValidation(origins ?? hosts)(c, next);
        });
      } else {
        // Host validation off: the SDK handler parses JSON itself when
        // parsedBody is absent (see mountMcp).
        if (origins !== undefined) {
          app.use("*", async (c, next) => {
            if (c.req.method === "GET" || c.req.method === "HEAD") {
              return await next();
            }
            return originValidation(origins)(c, next);
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
      const handler = mountMcp(app, (ctx) => this.#buildSdkServer(ctx), {
        path: this.#basePath(),
        ...(this.#config.legacy !== undefined && {
          handler: { legacy: this.#config.legacy },
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
    const existingBinding = this.#viewBindings.get(view.name);
    if (existingBinding !== undefined) {
      throw new Error(
        `View "${view.name}" is already bound to tool "${existingBinding.toolName}"; ` +
          `cannot bind a second tool "${definition.name}".`
      );
    }
    this.#viewBindings.set(view.name, { toolName: definition.name, config: view });
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
    const server = new SdkMcpServer(
      {
        name,
        version,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
      },
      instructions !== undefined ? { instructions } : undefined
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
    { definition, callback }: ToolEntry
  ): void {
    const view = definition.view;

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
      ...(view !== undefined && {
        _meta: buildToolUiMeta(view.name, view.visibility),
      }),
    };
    const wireResultMeta =
      view !== undefined ? buildToolResultUiMeta(view.name) : undefined;

    if (definition.schema !== undefined) {
      server.registerTool(
        definition.name,
        { ...config, inputSchema: definition.schema },
        async (args, ctx) => {
          // The SDK has already validated `args` against `definition.schema`.
          const params = args as Record<string, unknown>;
          const result = await callback(params, toRequestContext(ctx));
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
        const result = await callback({}, toRequestContext(ctx));
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
    { definition, callback }: ResourceEntry
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
      async (uri, ctx) => callback(uri, toRequestContext(ctx))
    );
  }

  #registerResourceTemplate(
    server: SdkMcpServer,
    { definition, callback }: ResourceTemplateEntry
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
          toRequestContext(ctx)
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
    { definition, callback }: PromptEntry
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
          return callback(params, toRequestContext(ctx));
        }
      );
    } else {
      // Without argsSchema the SDK invokes the callback as `(ctx)`, but its
      // published overloads only type the `(args, ctx)` shape — adapt with an
      // explicit, contained cast (verified against the SDK's
      // createPromptHandler implementation, 2.0.0-beta.1).
      const handler = async (ctx: ServerContext) =>
        callback({}, toRequestContext(ctx));
      server.registerPrompt(
        definition.name,
        config,
        handler as unknown as SdkPromptCallback<StandardSchemaWithJSON>
      );
    }
  }
}
