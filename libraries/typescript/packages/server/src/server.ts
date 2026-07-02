import { serve, type ServerType } from "@hono/node-server";
import { createMcpHonoApp, originValidation } from "@modelcontextprotocol/hono";
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer as SdkMcpServer,
  ResourceTemplate,
  type McpHttpHandler,
  type PromptCallback as SdkPromptCallback,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { ServerConfig } from "./config.js";
import { toRequestContext } from "./context.js";
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
   * Register a tool. Input is validated against `schema` before the callback
   * runs; results carrying `structuredContent` are type-checked against
   * `outputSchema` at the callback's return position.
   */
  tool<T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>>
  ): this {
    this.#assertNotStarted("tool", definition.name);
    this.#tools.set(definition.name, {
      definition,
      callback: callback as ToolCallback,
    });
    return this;
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
   * DNS-rebinding protection automatically. To serve publicly set
   * `host: "0.0.0.0"`; behind a platform edge that is all that's needed,
   * and `allowedHosts` restricts direct exposure (additive — localhost-class
   * values stay allowed).
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

  #ensureMounted(mode: "listen" | "handler"): {
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
      const handler = mountMcp(app, () => this.#buildSdkServer(), {
        path: this.#basePath(),
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

  /** Build a fresh SDK server from the registry (runs once per request). */
  #buildSdkServer(): SdkMcpServer {
    const { name, version, title, instructions } = this.#config;
    const server = new SdkMcpServer(
      { name, version, ...(title !== undefined && { title }) },
      instructions !== undefined ? { instructions } : undefined
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
    { definition, callback }: ToolEntry
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
          return callback(params, toRequestContext(ctx));
        }
      );
    } else {
      server.registerTool(definition.name, config, async (ctx) =>
        callback({}, toRequestContext(ctx))
      );
    }
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
