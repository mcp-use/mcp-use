import { serve, type ServerType } from "@hono/node-server";
import { createMcpHonoApp, originValidation } from "@modelcontextprotocol/hono";
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer as SdkMcpServer,
  ResourceTemplate,
  type AuthInfo,
  type McpHttpHandler,
  type PromptCallback as SdkPromptCallback,
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
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
} from "./tools.js";

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

interface ToolEntry<TUser> {
  definition: ToolDefinition;
  callback: ToolCallback<Record<string, unknown>, never, TUser, HasOAuth<TUser>>;
}

interface ResourceEntry<TUser> {
  definition: ResourceDefinition;
  callback: ResourceCallback<TUser, HasOAuth<TUser>>;
}

interface ResourceTemplateEntry<TUser> {
  definition: ResourceTemplateDefinition;
  callback: ResourceTemplateCallback<
    Record<string, TemplateVariableValue>,
    TUser,
    HasOAuth<TUser>
  >;
}

interface PromptEntry<TUser> {
  definition: PromptDefinition;
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
 *   { name: "add", schema: z.object({ a: z.number(), b: z.number() }) },
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
  readonly #resourceTemplates = new Map<
    string,
    ResourceTemplateEntry<TUser>
  >();
  readonly #prompts = new Map<string, PromptEntry<TUser>>();

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
   * to clients during initialization; nothing binds or listens until
   * {@link MCPServer.listen} or {@link MCPServer.getHandler} is called.
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
   * Register a tool. Input is validated against `schema` before the callback
   * runs; results carrying `structuredContent` are type-checked against
   * `outputSchema` at the callback's return position.
   */
  tool<T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<
      InferToolInput<T>,
      InferToolOutput<T>,
      TUser,
      HasOAuth<TUser>
    >
  ): this {
    this.#assertNotStarted("tool", definition.name);
    this.#tools.set(definition.name, {
      definition,
      callback: callback as ToolCallback<
        Record<string, unknown>,
        never,
        TUser,
        HasOAuth<TUser>
      >,
    });
    return this;
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
    callback: ResourceTemplateCallback<InferTemplateParams<T>, TUser, HasOAuth<TUser>>
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
   */
  getHandler(): (request: Request) => Promise<Response> {
    const { app } = this.#ensureMounted("handler");
    return async (request) => app.fetch(request);
  }

  /**
   * Serve over HTTP on Node. Pass port `0` for an ephemeral port.
   *
   * Binds `config.host` (default `127.0.0.1`). Localhost-class binds get
   * DNS-rebinding protection automatically. To serve publicly set
   * `host: "0.0.0.0"`; behind a platform edge that is all that's needed,
   * and `allowedHosts` restricts direct exposure (additive — localhost-class
   * values stay allowed).
   *
   * @throws If called on a localhost-class bind after {@link MCPServer.getHandler}
   * already mounted the app without Host validation.
   */
  async listen(port = 3000): Promise<{ port: number; url: string }> {
    this.#assertListenOAuthConfiguration();
    return new Promise((resolve, reject) => {
      let resolveApp: ((app: Hono) => void) | undefined;
      let rejectApp: ((error: unknown) => void) | undefined;
      const appReady = new Promise<Hono>((resolveAppPromise, rejectAppPromise) => {
        resolveApp = resolveAppPromise;
        rejectApp = rejectAppPromise;
      });
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
        void new Promise<void>((closeResolve) => server.close(() => closeResolve()))
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
      "OAuth requires an explicit resource or MCP_URL when using getHandler()"
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
   * mirroring the effective Host allowlist.
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

  #ensureMounted(mode: "listen" | "handler", listenPort?: number): {
    app: Hono;
    handler: McpHttpHandler;
  } {
    if (this.#app === undefined || this.#handler === undefined) {
      const { hosts, origins } = this.#validationPolicy(mode);
      let app: Hono;
      if (hosts !== undefined) {
        // Official Hono adapter: JSON body parsing plus Host/Origin
        // validation against exactly the computed lists (passing explicit
        // lists bypasses the adapter's own host-keyed defaulting).
        app = createMcpHonoApp({
          allowedHosts: hosts,
          allowedOrigins: origins ?? hosts,
        });
      } else {
        // Host validation off: mount on a bare app (the SDK handler parses
        // the JSON body itself; see mountMcp).
        app = new Hono();
        if (origins !== undefined) {
          app.use("*", originValidation(origins));
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
      app.use("*", requestLogger(this.#config.logging));
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
      const handler = mountMcp(
        mcpApp,
        ({ authInfo }) => this.#buildSdkServer(authInfo),
        {
          path: this.#basePath(),
          ...(resource !== undefined && {
            authInfo: (context) => context.get("authInfo"),
          }),
        }
      );
      // Inspector shell (default enabled, FastAPI /docs style) rides the
      // same app, so the validation middleware above covers it too.
      mountInspectorShell(app, this.#config.inspector, {
        serverName: this.#config.name,
        basePath: this.#basePath(),
      });
      // Custom routes last: after OAuth wiring and MCP/inspector mounts so
      // they cannot run before the bearer gate and are not shadowed-checked
      // against MCP internals. Not covered by the OAuth gate (basePath only).
      this.#config.configureApp?.(app);
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

  /** Build a fresh SDK server from the registry (runs once per request). */
  #buildSdkServer(authInfo?: AuthInfo): SdkMcpServer {
    const { name, version, title, instructions } = this.#config;
    const server = new SdkMcpServer(
      { name, version, ...(title !== undefined && { title }) },
      {
        ...(instructions !== undefined && { instructions }),
        ...(authInfo !== undefined && { authInfo }),
      }
    );

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
    return server;
  }

  #registerTool(
    server: SdkMcpServer,
    { definition, callback }: ToolEntry<TUser>
  ): void {
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
    };
    if (definition.schema !== undefined) {
      server.registerTool(
        definition.name,
        { ...config, inputSchema: definition.schema },
        async (args, ctx) => {
          // The SDK has already validated `args` against `definition.schema`.
          const params = args as Record<string, unknown>;
          return callback(params, this.#toRequestContext(ctx));
        }
      );
    } else {
      server.registerTool(definition.name, config, async (ctx) =>
        callback({}, this.#toRequestContext(ctx))
      );
    }
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

  #toRequestContext(ctx: ServerContext): RequestContext<TUser, HasOAuth<TUser>> {
    if (this.#config.oauth === undefined) {
      return toRequestContext(ctx) as RequestContext<TUser, HasOAuth<TUser>>;
    }
    return toAuthenticatedRequestContext<TUser>(ctx) as RequestContext<TUser, HasOAuth<TUser>>;
  }
}
