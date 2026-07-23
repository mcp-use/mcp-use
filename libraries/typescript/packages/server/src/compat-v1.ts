/**
 * Deprecated v1 server compatibility entry.
 *
 * This file intentionally contains the complete server-side bridge. It
 * normalizes the common v1 authoring shapes and delegates all protocol and
 * HTTP behavior to the native v2 server.
 */

import type {
  AuthInfo as SdkAuthInfo,
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Context, Env, Next } from "hono";

import type { ServerConfig as NativeServerConfig } from "./config.js";
import type { RequestContext, RequestClientContext } from "./context.js";
import type { FromOpenAPIOptions } from "./openapi/types.js";
import type { OAuthProvider } from "./oauth/provider.js";
import type { PromptDefinition as NativePromptDefinition } from "./prompts.js";
import {
  array as nativeArray,
  audio,
  binary,
  css,
  error,
  html,
  image,
  javascript,
  markdown,
  mix,
  object,
  resource,
  text,
  widget as nativeWidget,
  xml,
  type ToolContentResult,
  type TypedCallToolResult,
  type WidgetResponseConfig,
} from "./response-helpers.js";
import type {
  ResourceDefinition as NativeResourceDefinition,
  ResourceTemplateDefinition as NativeResourceTemplateDefinition,
} from "./resources.js";
import { MCPServer as NativeMCPServer } from "./server.js";
import type {
  ToolDefinition as NativeToolDefinition,
  ToolViewConfig,
} from "./tools.js";
import type { ViewsManifest } from "./views/types.js";
import { getRequestBag } from "./fetch-app.js";

const COMPAT_MESSAGE =
  'Deprecated temporary v1 compatibility. Use the native v2 API from "mcp-use". This entry will be removed in mcp-use v3.';
const COMPAT_CODE = "MCP_USE_V1_COMPAT";
const COMPAT_GLOBAL = "__mcpUseV1CompatServer";
let warned = false;

type UnknownRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

/**
 * Authenticated user shape exposed by the v1 callback context.
 *
 * @deprecated Temporary v1 compatibility. Native v2 providers expose their
 * provider-specific user type at `ctx.auth.user`. Removed in mcp-use v3.
 */
export interface UserInfo extends UnknownRecord {
  /** Stable v1 user identifier. */
  userId: string;
  /** Optional email claim. */
  email?: string;
  /** Optional display name. */
  name?: string;
  /** Optional role list. */
  roles?: string[];
  /** Optional permission list. */
  permissions?: string[];
  /** Optional scope list. */
  scopes?: string[];
}

/**
 * Authentication data exposed by v1-compatible callbacks.
 *
 * @deprecated Use native v2 `OAuthAuth` from `mcp-use`. Removed in mcp-use v3.
 */
export interface AuthInfo {
  /** Normalized legacy user object. */
  user: UserInfo;
  /** Verified token payload. */
  payload: UnknownRecord;
  /** Original bearer token. */
  accessToken: string;
  /** Granted scopes. */
  scopes: string[];
  /** Granted permissions. */
  permissions: string[];
}

/**
 * v1 client helpers plus the v1 `supportsApps()` spelling.
 *
 * @deprecated Use native v2 `RequestClientContext`; replace `supportsApps()`
 * with `supportsViews()`. Removed in mcp-use v3.
 */
export interface ClientCapabilityChecker extends RequestClientContext {
  /** Alias for native v2 `supportsViews()`. */
  supportsApps(): boolean;
}

/**
 * Common v1 callback context translated onto the request-scoped v2 context.
 * Session-backed sampling and blocking elicitation are intentionally absent.
 *
 * @deprecated Use native v2 `RequestContext` from `mcp-use`. Removed in
 * mcp-use v3.
 */
export type McpContext<_HasOAuth extends boolean = false> = Omit<
  RequestContext<never, false>,
  "auth" | "client"
> & {
  /** v1-compatible client metadata helpers. */
  client: ClientCapabilityChecker;
  /** v1 name for native v2 `sendLog()`. */
  log(
    level:
      | "debug"
      | "info"
      | "notice"
      | "warning"
      | "error"
      | "critical"
      | "alert"
      | "emergency",
    data: unknown,
    logger?: string
  ): Promise<void>;
} & {
  /**
   * v1 authentication context. The compatibility entry keeps this
   * non-optional because the v1 constructor inferred OAuth from
   * `config.oauth`; callbacks still only receive it when OAuth is configured.
   */
  auth: AuthInfo;
};

/**
 * Common v1 CORS option names.
 *
 * @deprecated Use `CorsOptions` from `mcp-use`. Removed in mcp-use v3.
 */
export interface CorsOptions {
  /** Allowed response origin or origins. */
  origin?: string | string[];
  /** v1 spelling for allowed HTTP methods. */
  allowMethods?: string[];
  /** v1 spelling for allowed request headers. */
  allowHeaders?: string[];
  /** Whether credentials are allowed. */
  credentials?: boolean;
}

/**
 * Common v1 constructor configuration supported by the temporary bridge.
 *
 * @deprecated Use `ServerConfig` from `mcp-use`. Removed in mcp-use v3.
 */
export interface ServerConfig {
  /** Server implementation name. */
  name: string;
  /** Server implementation version. */
  version: string;
  /** Display title. */
  title?: string;
  /** Server description. */
  description?: string;
  /** Model-facing server instructions. */
  instructions?: string;
  /** Node listener host. */
  host?: string;
  /** Node listener port. */
  port?: number;
  /** Public v1 server URL. */
  baseUrl?: string;
  /** v1 Host allowlist despite the historical option name. */
  allowedOrigins?: string[];
  /** v1 CORS configuration. */
  cors?: CorsOptions;
  /** Stateless mode is accepted only when true. */
  stateless?: boolean;
  /** Unsupported v1 session idle timeout. */
  sessionIdleTimeoutMs?: number;
  /** Unsupported v1 stale-session behavior. */
  autoCreateSessionOnInvalidId?: boolean;
  /** Unsupported v1 session storage. */
  sessionStore?: unknown;
  /** Unsupported v1 stream manager. */
  streamManager?: unknown;
  /** Built-in external OAuth resource-server provider. */
  oauth?: OAuthProvider<unknown>;
  /** Whether the landing page is public with OAuth enabled. */
  publicLandingPage?: boolean;
  /** Browser favicon. */
  favicon?: string;
  /** Server icons. */
  icons?: NativeServerConfig["icons"];
  /** Server website. */
  websiteUrl?: string;
}

/**
 * v1 tool-to-widget binding.
 *
 * @deprecated Use native v2 `view` from `mcp-use`. Removed in mcp-use v3.
 */
export interface ToolWidgetConfig {
  /** Legacy widget directory name. */
  name: string;
  /** Invocation status text. */
  invoking?: string;
  /** Completion status text. */
  invoked?: string;
  /** Whether the widget may call tools. */
  widgetAccessible?: boolean;
  /** Whether the result can open the widget. */
  resultCanProduceWidget?: boolean;
}

/**
 * Common v1 tool definition.
 *
 * @deprecated Use native v2 `ToolDefinition` and pass the callback separately.
 * Removed in mcp-use v3.
 */
export interface ToolDefinition<
  TInput = UnknownRecord,
  TOutput = UnknownRecord,
  HasOAuth extends boolean = false,
> extends Omit<NativeToolDefinition, "inputSchema" | "view"> {
  /** Zod/Standard Schema input definition. */
  schema?: StandardSchemaWithJSON;
  /** Unsupported legacy array schema. */
  inputs?: unknown[];
  /** Optional inline callback. */
  cb?: ToolCallback<TInput, TOutput, HasOAuth>;
  /** Legacy widget binding. */
  widget?: ToolWidgetConfig;
}

/**
 * Common v1 tool callback.
 *
 * @deprecated Use native v2 `ToolCallback` from `mcp-use`. Removed in mcp-use
 * v3.
 */
export type ToolCallback<
  TInput = UnknownRecord,
  TOutput = UnknownRecord,
  HasOAuth extends boolean = false,
> = (
  params: TInput,
  ctx: McpContext<HasOAuth>
) => MaybePromise<
  | CallToolResult
  | TypedCallToolResult<Extract<TOutput, UnknownRecord>>
  | ToolContentResult
>;

/**
 * Infer v1 tool input from its Standard Schema.
 *
 * @deprecated Use native v2 `InferToolInput`. Removed in mcp-use v3.
 */
export type InferToolInput<T> = T extends {
  schema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S>
  : UnknownRecord;

/**
 * Infer v1 tool structured output from its Standard Schema.
 *
 * @deprecated Use native v2 `InferToolOutput`. Removed in mcp-use v3.
 */
export type InferToolOutput<T> = T extends {
  outputSchema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S>
  : UnknownRecord;

/**
 * Common v1 static-resource definition.
 *
 * @deprecated Use native v2 `ResourceDefinition` and pass the reader
 * separately. Removed in mcp-use v3.
 */
export interface ResourceDefinition<
  HasOAuth extends boolean = false,
> extends NativeResourceDefinition {
  /** Optional inline v1 reader. */
  readCallback?: ReadResourceCallback<HasOAuth>;
  /** Legacy completion container; ignored for static resources. */
  callbacks?: { complete?: Record<string, unknown> };
}

/**
 * Common v1 static-resource callback. The first argument is context, not URI.
 *
 * @deprecated Use native v2 `ResourceCallback`. Removed in mcp-use v3.
 */
export type ReadResourceCallback<HasOAuth extends boolean = false> = (
  ctx: McpContext<HasOAuth>
) => MaybePromise<ReadResourceResult | CallToolResult>;

/**
 * v1 nested resource-template configuration.
 *
 * @deprecated Use native v2 `ResourceTemplateDefinition`. Removed in mcp-use
 * v3.
 */
export interface ResourceTemplateConfig {
  /** RFC 6570 URI template. */
  uriTemplate: string;
  /** Optional nested name. */
  name?: string;
  /** MIME type. */
  mimeType?: string;
  /** Description. */
  description?: string;
  /** Legacy completion callbacks. */
  callbacks?: { complete?: Record<string, unknown> };
}

/**
 * Common nested or flat v1 resource-template definition.
 *
 * @deprecated Use native v2 `ResourceTemplateDefinition`. Removed in mcp-use
 * v3.
 */
export interface ResourceTemplateDefinition<HasOAuth extends boolean = false> {
  /** Registration name. */
  name: string;
  /** Flat v1 URI-template form. */
  uriTemplate?: string;
  /** Nested v1 URI-template form. */
  resourceTemplate?: ResourceTemplateConfig;
  /** Optional title. */
  title?: string;
  /** Optional description. */
  description?: string;
  /** Optional MIME type. */
  mimeType?: string;
  /** Optional annotations. */
  annotations?: NativeResourceTemplateDefinition["annotations"];
  /** Optional descriptor metadata. */
  _meta?: NativeResourceTemplateDefinition["_meta"];
  /** Schema used only for v1 parameter inference. */
  schema?: StandardSchemaWithJSON;
  /** Legacy completion callbacks. */
  callbacks?: { complete?: Record<string, unknown> };
  /** Optional inline reader. */
  readCallback?: ReadResourceTemplateCallback<UnknownRecord, HasOAuth>;
}

/**
 * Common v1 resource-template callback signatures.
 *
 * @deprecated Use native v2 `ResourceTemplateCallback`. Removed in mcp-use
 * v3.
 */
export type ReadResourceTemplateCallback<
  TParams extends UnknownRecord = Record<string, string>,
  HasOAuth extends boolean = false,
> = (
  uri: URL,
  params: TParams,
  ctx: McpContext<HasOAuth>
) => MaybePromise<
  | ReadResourceResult
  | CallToolResult
  | TypedCallToolResult<UnknownRecord>
  | ToolContentResult
>;

/** Infer v1 resource-template parameters from an optional Standard Schema. */
type InferResourceTemplateParams<T> = T extends {
  schema: infer S extends StandardSchemaWithJSON;
}
  ? Extract<StandardSchemaWithJSON.InferOutput<S>, UnknownRecord>
  : Record<string, string>;

/**
 * Common v1 prompt definition.
 *
 * @deprecated Use native v2 `PromptDefinition` and pass the callback
 * separately. Removed in mcp-use v3.
 */
export interface PromptDefinition<
  TInput = UnknownRecord,
  HasOAuth extends boolean = false,
> extends NativePromptDefinition {
  /** Unsupported legacy argument array. */
  args?: unknown[];
  /** Optional inline v1 callback. */
  cb?: PromptCallback<TInput, HasOAuth>;
}

/**
 * Common v1 prompt callback.
 *
 * @deprecated Use native v2 `PromptCallback`. Removed in mcp-use v3.
 */
export type PromptCallback<
  TInput = UnknownRecord,
  HasOAuth extends boolean = false,
> = (
  params: TInput,
  ctx: McpContext<HasOAuth>
) => MaybePromise<GetPromptResult | CallToolResult>;

/**
 * Infer v1 prompt input from its Standard Schema.
 *
 * @deprecated Use native v2 `InferPromptInput`. Removed in mcp-use v3.
 */
export type InferPromptInput<T> = T extends {
  schema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S>
  : UnknownRecord;

interface LegacyWidgetMetadata {
  title?: string;
  description?: string;
  props?: StandardSchemaWithJSON | unknown[];
  inputs?: StandardSchemaWithJSON | unknown[];
  schema?: StandardSchemaWithJSON | unknown[];
  toolOutput?:
    | CallToolResult
    | ((params: UnknownRecord) => MaybePromise<CallToolResult>);
  exposeAsTool?: boolean;
  annotations?: NativeToolDefinition["annotations"];
  _meta?: UnknownRecord;
  metadata?: {
    description?: string;
    csp?: ToolViewConfig["csp"];
    prefersBorder?: boolean;
    domain?: string;
    widgetDescription?: string;
    autoResize?: boolean;
    invoking?: string;
    invoked?: string;
  };
  appsSdkMetadata?: {
    "openai/widgetDescription"?: string;
    "openai/widgetCSP"?: {
      connect_domains?: string[];
      resource_domains?: string[];
      frame_domains?: string[];
    };
    "openai/widgetPrefersBorder"?: boolean;
    "openai/widgetDomain"?: string;
  };
}

interface PendingWidgetTool {
  definition: ToolDefinition<unknown, unknown, boolean>;
  callback: ToolCallback<unknown, unknown, boolean>;
}

/**
 * Temporary v1-compatible server facade backed by the native stateless v2
 * server.
 *
 * @deprecated Temporary v1 compatibility. Import `MCPServer` from `mcp-use`.
 * Removed in mcp-use v3.
 */
export class MCPServer<
  HasOAuth extends boolean = false,
  TEnv extends Env = Env,
> {
  readonly #native: NativeMCPServer<unknown, TEnv>;
  readonly #pendingWidgetTools = new Map<string, PendingWidgetTool>();
  readonly #legacyWidgetMetadata = new Map<string, LegacyWidgetMetadata>();
  readonly #boundLegacyViews = new Set<string>();

  /** Original v1 configuration. */
  readonly config: ServerConfig;
  /** Native Hono application. */
  readonly app: NativeMCPServer<unknown, TEnv>["app"];
  /** Native Web-standard fetch handler. */
  readonly fetch: NativeMCPServer<unknown, TEnv>["fetch"];
  /** Native Hono GET route helper. */
  readonly get: NativeMCPServer<unknown, TEnv>["get"];
  /** Native Hono POST route helper. */
  readonly post: NativeMCPServer<unknown, TEnv>["post"];
  /** Native Hono PUT route helper. */
  readonly put: NativeMCPServer<unknown, TEnv>["put"];
  /** Native Hono PATCH route helper. */
  readonly patch: NativeMCPServer<unknown, TEnv>["patch"];
  /** Native Hono DELETE route helper. */
  readonly delete: NativeMCPServer<unknown, TEnv>["delete"];
  /** Native Hono all-method route helper. */
  readonly all: NativeMCPServer<unknown, TEnv>["all"];
  /** Native HTTP/MCP middleware registration. */
  readonly use: NativeMCPServer<unknown, TEnv>["use"];
  /** Native MCP observer registration. */
  readonly on: NativeMCPServer<unknown, TEnv>["on"];
  /** Configured listener host. */
  readonly serverHost: string;
  /** Actual listener port after standalone `listen()`. */
  serverPort?: number;
  /** Configured public URL. */
  readonly serverBaseUrl?: string;

  /**
   * Create a v1-compatible facade.
   *
   * @param config - Common v1 server configuration.
   */
  constructor(config: ServerConfig) {
    warnCompat();
    assertSupportedConfig(config);
    this.config = config;
    this.serverHost = config.host ?? "localhost";
    if (config.baseUrl !== undefined) this.serverBaseUrl = config.baseUrl;
    this.#native = new NativeMCPServer<unknown, TEnv>(
      normalizeServerConfig(config) as unknown as NativeServerConfig<unknown>
    );
    this.app = this.#native.app;
    this.fetch = this.#native.fetch;
    this.get = this.#native.get;
    this.post = this.#native.post;
    this.put = this.#native.put;
    this.patch = this.#native.patch;
    this.delete = this.#native.delete;
    this.all = this.#native.all;
    this.use = this.#native.use.bind(this.#native) as typeof this.use;
    this.on = this.#native.on.bind(this.#native) as typeof this.on;
    const capture = globalThis as UnknownRecord;
    if (
      process.env["MCP_USE_CLI_IMPORT"] === "1" &&
      capture[COMPAT_GLOBAL] !== undefined
    ) {
      throw unsupported(
        "multiple compatibility servers in one CLI entry",
        "default-export one native v2 server or construct only one v1 server"
      );
    }
    capture[COMPAT_GLOBAL] = this;
  }

  /**
   * Create a v1-compatible server from an OpenAPI document.
   *
   * @deprecated Use native v2 `MCPServer.fromOpenAPI()` from `mcp-use`.
   * Removed in mcp-use v3.
   */
  static fromOpenAPI(options: FromOpenAPIOptions): MCPServer {
    return NativeMCPServer.fromOpenAPI(options) as unknown as MCPServer;
  }

  /** Native v2 MCP route path. */
  get basePath(): string {
    return this.#native.basePath;
  }

  /** Configured native listener host. */
  get host(): string | undefined {
    return this.#native.host;
  }

  /** Configured native listener port. */
  get port(): number | undefined {
    return this.#native.port;
  }

  /** Native normalized branding. */
  get branding(): NativeMCPServer<unknown, TEnv>["branding"] {
    return this.#native.branding;
  }

  /**
   * Register a common v1 tool shape.
   *
   * @returns This facade for v1 method chaining.
   */
  tool<T extends Omit<ToolDefinition, "cb">>(
    definition: T & {
      cb: ToolCallback<InferToolInput<T>, InferToolOutput<T>, HasOAuth>;
    }
  ): this;
  /** Register a common v1 tool with a separate callback. */
  tool<T extends Omit<ToolDefinition, "cb">>(
    definition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>, HasOAuth>
  ): this;
  tool(
    definition: ToolDefinition<unknown, unknown, HasOAuth>,
    callback?: ToolCallback<unknown, unknown, HasOAuth>
  ): this {
    if (definition.inputs !== undefined) {
      throw unsupported("tool inputs[] schemas", "use a Zod schema field");
    }
    const inline = definition.cb;
    if (inline !== undefined && callback !== undefined) {
      throw new TypeError(
        `Tool "${definition.name}" provides both cb and a separate callback.`
      );
    }
    const selected = callback ?? inline;
    if (selected === undefined) {
      throw new TypeError(`Tool "${definition.name}" requires a callback.`);
    }

    if (definition.widget !== undefined) {
      const viewName = definition.widget.name;
      if (
        this.#pendingWidgetTools.has(viewName) ||
        this.#boundLegacyViews.has(viewName)
      ) {
        throw unsupported(
          `binding legacy widget "${viewName}" to multiple tools`,
          "use one tool per view or migrate the bindings to native v2"
        );
      }
      this.#boundLegacyViews.add(viewName);
      this.#pendingWidgetTools.set(viewName, {
        definition: definition as ToolDefinition<unknown, unknown, boolean>,
        callback: selected as ToolCallback<unknown, unknown, boolean>,
      });
      return this;
    }

    this.#registerTool(definition, selected);
    return this;
  }

  /** Register a common v1 static resource. */
  resource(
    definition: ResourceDefinition<HasOAuth>,
    callback?: ReadResourceCallback<HasOAuth>
  ): this {
    const selected = callback ?? definition.readCallback;
    if (callback !== undefined && definition.readCallback !== undefined) {
      throw new TypeError(
        `Resource "${definition.name}" provides both readCallback and a separate callback.`
      );
    }
    if (selected === undefined) {
      throw new TypeError(`Resource "${definition.name}" requires a callback.`);
    }
    const {
      readCallback: _readCallback,
      callbacks: _callbacks,
      ...native
    } = definition;
    this.#native.resource(native, async (_uri, ctx) =>
      selected(decorateContext(ctx) as McpContext<HasOAuth>)
    );
    return this;
  }

  /** Register a common nested or flat v1 resource template. */
  resourceTemplate<
    T extends Omit<ResourceTemplateDefinition<HasOAuth>, "readCallback">,
  >(
    definition: T & {
      readCallback: ReadResourceTemplateCallback<
        InferResourceTemplateParams<T>,
        HasOAuth
      >;
    }
  ): this;
  resourceTemplate<
    T extends Omit<ResourceTemplateDefinition<HasOAuth>, "readCallback">,
  >(
    definition: T,
    callback: ReadResourceTemplateCallback<
      InferResourceTemplateParams<T>,
      HasOAuth
    >
  ): this;
  resourceTemplate(
    definition: ResourceTemplateDefinition<HasOAuth>,
    callback?: ReadResourceTemplateCallback<Record<string, string>, HasOAuth>
  ): this {
    const selected = callback ?? definition.readCallback;
    if (callback !== undefined && definition.readCallback !== undefined) {
      throw new TypeError(
        `Resource template "${definition.name}" provides both readCallback and a separate callback.`
      );
    }
    if (selected === undefined) {
      throw new TypeError(
        `Resource template "${definition.name}" requires a callback.`
      );
    }
    const nested = definition.resourceTemplate;
    const uriTemplate = definition.uriTemplate ?? nested?.uriTemplate;
    if (uriTemplate === undefined) {
      throw new TypeError(
        `Resource template "${definition.name}" requires uriTemplate.`
      );
    }
    const complete =
      definition.callbacks?.complete ?? nested?.callbacks?.complete;
    const description = definition.description ?? nested?.description;
    const mimeType = definition.mimeType ?? nested?.mimeType;
    const native: NativeResourceTemplateDefinition<string> = {
      name: definition.name,
      uriTemplate,
      ...(definition.title !== undefined && { title: definition.title }),
      ...(description !== undefined && { description }),
      ...(mimeType !== undefined && { mimeType }),
      ...(definition.annotations !== undefined && {
        annotations: definition.annotations,
      }),
      ...(definition._meta !== undefined && { _meta: definition._meta }),
      ...(complete !== undefined && {
        complete: complete as NonNullable<
          NativeResourceTemplateDefinition<string>["complete"]
        >,
      }),
    };
    this.#native.resourceTemplate(native, async (uri, params, ctx) =>
      selected(
        uri,
        params as Record<string, string>,
        decorateContext(ctx) as McpContext<HasOAuth>
      )
    );
    return this;
  }

  /** Register a common v1 prompt shape. */
  prompt<T extends Omit<PromptDefinition, "cb">>(
    definition: T & { cb: PromptCallback<InferPromptInput<T>, HasOAuth> }
  ): this;
  /** Register a common v1 prompt with a separate callback. */
  prompt<T extends Omit<PromptDefinition, "cb">>(
    definition: T,
    callback: PromptCallback<InferPromptInput<T>, HasOAuth>
  ): this;
  prompt(
    definition: PromptDefinition<unknown, HasOAuth>,
    callback?: PromptCallback<unknown, HasOAuth>
  ): this {
    if (definition.args !== undefined) {
      throw unsupported("prompt args[] schemas", "use a Zod schema field");
    }
    const inline = definition.cb;
    if (inline !== undefined && callback !== undefined) {
      throw new TypeError(
        `Prompt "${definition.name}" provides both cb and a separate callback.`
      );
    }
    const selected = callback ?? inline;
    if (selected === undefined) {
      throw new TypeError(`Prompt "${definition.name}" requires a callback.`);
    }
    const { cb: _cb, args: _args, ...native } = definition;
    this.#native.prompt(native, async (params, ctx) =>
      selected(params, decorateContext(ctx) as McpContext<HasOAuth>)
    );
    return this;
  }

  /**
   * Start a standalone listener. Inside `mcp-use dev/build/start`, the call is
   * captured because the CLI owns the listener.
   */
  async listen(
    port?: number,
    options?: Parameters<NativeMCPServer<unknown, TEnv>["listen"]>[1]
  ): Promise<void | { port: number; url: string }> {
    if (process.env["MCP_USE_CLI_IMPORT"] === "1") return;
    this.#flushPendingWidgetTools();
    const listening = await this.#native.listen(port, options);
    this.serverPort = listening.port;
    return listening;
  }

  /** Close the native v2 server. */
  async close(): Promise<void> {
    await this.#native.close();
  }

  /** Deprecated v1 handler accessor backed by native `fetch`. */
  getHandler(): typeof this.fetch {
    return this.fetch;
  }

  /** Delegate supported HTTP upstream proxy registrations to v2. */
  async proxy(
    ...args: Parameters<NativeMCPServer<unknown, TEnv>["proxy"]>
  ): Promise<void> {
    await this.#native.proxy(...args);
  }

  /** Delegate resource-update notifications to v2. */
  async notifyResourceUpdated(uri: string): Promise<void> {
    await this.#native.notifyResourceUpdated(uri);
  }

  /** @internal Called by the v2 CLI before view priming. */
  __registerLegacyViews(
    widgets: Record<string, { widgetMetadata?: LegacyWidgetMetadata }>
  ): void {
    for (const [name, module] of Object.entries(widgets)) {
      const metadata = module.widgetMetadata ?? {};
      this.#legacyWidgetMetadata.set(name, metadata);
      this.#flushPendingWidgetTool(name);
      if (metadata.exposeAsTool === true && !this.#boundLegacyViews.has(name)) {
        this.#registerAutoWidgetTool(name, metadata);
      }
    }
  }

  /** @internal Prime the native view manifest after legacy metadata loading. */
  __primeViews(
    views: ViewsManifest,
    options?: { dev?: boolean; projectRoot?: string }
  ): void {
    this.#flushPendingWidgetTools();
    this.#native.__primeViews(views, options);
  }

  /** @internal Mount and validate the native v2 application. */
  __mount(): void {
    this.#flushPendingWidgetTools();
    this.#native.__mount();
  }

  /** @internal Attach the CLI development event bus. */
  __setEventBus(
    bus: Parameters<NativeMCPServer<unknown, TEnv>["__setEventBus"]>[0]
  ): void {
    this.#native.__setEventBus(bus);
  }

  #registerTool(
    definition: ToolDefinition<unknown, unknown, HasOAuth>,
    callback: ToolCallback<unknown, unknown, HasOAuth>,
    viewName?: string,
    metadata?: LegacyWidgetMetadata
  ): void {
    const {
      cb: _cb,
      widget: widgetConfig,
      inputs: _inputs,
      ...rest
    } = definition;
    const view =
      viewName === undefined ? undefined : legacyViewConfig(viewName, metadata);
    const outputSchema =
      rest.outputSchema ??
      (viewName === undefined
        ? undefined
        : (metadataSchema(metadata) ?? passthroughObjectSchema));
    const invocationMeta = legacyInvocationMeta(widgetConfig, metadata);
    const native: NativeToolDefinition = {
      ...rest,
      ...(outputSchema !== undefined && { outputSchema }),
      ...(view !== undefined && { view }),
      ...((rest._meta !== undefined || invocationMeta !== undefined) && {
        _meta: { ...rest._meta, ...invocationMeta },
      }),
    };
    this.#native.tool(native, async (params, ctx) =>
      callback(params, decorateContext(ctx) as McpContext<HasOAuth>)
    );
  }

  #flushPendingWidgetTool(name: string): void {
    const pending = this.#pendingWidgetTools.get(name);
    if (pending === undefined) return;
    this.#pendingWidgetTools.delete(name);
    this.#registerTool(
      pending.definition as ToolDefinition<unknown, unknown, HasOAuth>,
      pending.callback as ToolCallback<unknown, unknown, HasOAuth>,
      name,
      this.#legacyWidgetMetadata.get(name)
    );
  }

  #flushPendingWidgetTools(): void {
    for (const name of [...this.#pendingWidgetTools.keys()]) {
      this.#flushPendingWidgetTool(name);
    }
  }

  #registerAutoWidgetTool(name: string, metadata: LegacyWidgetMetadata): void {
    this.#boundLegacyViews.add(name);
    const schema = metadataSchema(metadata) ?? passthroughObjectSchema;
    const native: NativeToolDefinition = {
      name,
      ...(metadata.title !== undefined && { title: metadata.title }),
      description:
        metadata.description ??
        metadata.metadata?.description ??
        `Display ${name}`,
      inputSchema: schema,
      outputSchema: schema,
      ...(metadata.annotations !== undefined && {
        annotations: metadata.annotations,
      }),
      _meta: {
        ...metadata._meta,
        ...legacyInvocationMeta(undefined, metadata),
      },
      view: legacyViewConfig(name, metadata),
    };
    this.#native.tool(native, async (params) => {
      const configured =
        typeof metadata.toolOutput === "function"
          ? await metadata.toolOutput(params)
          : metadata.toolOutput;
      return {
        content: configured?.content ?? [
          { type: "text" as const, text: `${metadata.title ?? name} ready` },
        ],
        structuredContent: params,
        ...(configured?.isError === true && { isError: true }),
        ...(configured?._meta !== undefined && { _meta: configured._meta }),
      };
    });
  }
}

/**
 * Create a v1-compatible server using the old name-plus-config factory.
 *
 * @deprecated Use `new MCPServer(...)` from `mcp-use`. Removed in mcp-use v3.
 */
export function createMCPServer(
  name: string,
  config: Partial<ServerConfig> = {}
): MCPServer {
  return new MCPServer({ name, version: config.version ?? "1.0.0", ...config });
}

/**
 * v1 array helper preserving `structuredContent: { data }`.
 *
 * @deprecated Return a raw v2 tool result. Removed in mcp-use v3.
 */
export function array<T extends unknown[]>(data: T): CallToolResult {
  const result = nativeArray(data);
  return { ...result, structuredContent: { data } };
}

/**
 * v1 widget helper that always emits an object `structuredContent` value.
 *
 * @deprecated Register a native v2 `view` and return a raw result. Removed in
 * mcp-use v3.
 */
export function widget<TProps extends UnknownRecord = UnknownRecord>(
  config: WidgetResponseConfig<TProps>
): TypedCallToolResult<TProps> {
  const result = nativeWidget(config);
  return {
    ...result,
    structuredContent:
      result.structuredContent ?? config.props ?? config.data ?? ({} as TProps),
  };
}

/** @deprecated Import `text` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { text };
/** @deprecated Import `markdown` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { markdown };
/** @deprecated Import `html` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { html };
/** @deprecated Import `xml` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { xml };
/** @deprecated Import `css` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { css };
/** @deprecated Import `javascript` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { javascript };
/** @deprecated Import `object` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { object };
/** @deprecated Import `image` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { image };
/** @deprecated Import `audio` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { audio };
/** @deprecated Import `binary` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { binary };
/** @deprecated Import `resource` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { resource };
/** @deprecated Import `mix` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { mix };
/** @deprecated Import `error` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { error };
/** @deprecated Import `completable` from `mcp-use` only while migrating. Removed in mcp-use v3. */
export { completable } from "./completable.js";
/** @deprecated Use raw v2 result types from `mcp-use`. Removed in mcp-use v3. */
export type { ToolContentResult, TypedCallToolResult, WidgetResponseConfig };
/** @deprecated Use raw SDK result types from `mcp-use`. Removed in mcp-use v3. */
export type { CallToolResult, GetPromptResult, ReadResourceResult };
/** @deprecated Use native v2 OpenAPI types from `mcp-use`. Removed in mcp-use v3. */
export type {
  FromOpenAPIOptions,
  OpenAPIAuth,
  OpenAPIDocument,
  OpenAPIExcludeRule,
} from "./openapi/types.js";
/** @deprecated Import from `mcp-use/oauth/*`. Removed in mcp-use v3. */
export {
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthClerkProvider,
  oauthKeycloakProvider,
  oauthSupabaseProvider,
  oauthWorkOSProvider,
} from "./compat-v1/oauth.js";
/** @deprecated Use native v2 middleware types from `mcp-use`. Removed in mcp-use v3. */
export type {
  McpMiddlewareFn,
  McpMiddlewareFnFor,
  McpMiddlewarePattern,
  MiddlewareContext,
} from "./middleware/mcp-middleware.js";

/**
 * Read v1-compatible authentication data from a tool or Hono context.
 *
 * @deprecated Read `ctx.auth` directly in native v2. Removed in mcp-use v3.
 */
export function getAuth(context: McpContext<boolean> | Context): AuthInfo {
  const direct = (context as { auth?: AuthInfo }).auth;
  if (direct !== undefined) return direct;
  const stored = (context as Context).get?.("auth") as AuthInfo | undefined;
  if (stored !== undefined) return stored;
  const request = (context as Context).req?.raw;
  const verified =
    request === undefined ? undefined : getRequestBag(request).authInfo;
  if (verified !== undefined) return compatAuthFromSdk(verified);
  throw new Error("Authentication context is missing.");
}

/** @deprecated Check `ctx.auth.scopes` in native v2. Removed in mcp-use v3. */
export function hasScope(
  context: McpContext<boolean> | Context,
  needed: string | string[]
): boolean {
  const auth = getAuth(context);
  const required = Array.isArray(needed) ? needed : [needed];
  return required.every(
    (scope) => auth.scopes.includes(scope) || auth.permissions.includes(scope)
  );
}

/** @deprecated Check `ctx.auth.scopes` in native v2. Removed in mcp-use v3. */
export function hasAnyScope(
  context: McpContext<boolean> | Context,
  needed: string[]
): boolean {
  const auth = getAuth(context);
  return needed.some(
    (scope) => auth.scopes.includes(scope) || auth.permissions.includes(scope)
  );
}

/** @deprecated Write native v2 Hono middleware. Removed in mcp-use v3. */
export function requireScope(needed: string | string[]) {
  return async (context: Context, next: Next): Promise<Response | void> => {
    if (hasScope(context, needed)) return next();
    const auth = getAuth(context);
    const required = Array.isArray(needed) ? needed : [needed];
    return context.json(
      {
        error: "insufficient_scope",
        required,
        granted_scopes: auth.scopes,
        granted_permissions: auth.permissions,
      },
      403
    );
  };
}

/** @deprecated Write native v2 Hono middleware. Removed in mcp-use v3. */
export function requireAnyScope(needed: string[]) {
  return async (context: Context, next: Next): Promise<Response | void> => {
    if (hasAnyScope(context, needed)) return next();
    const auth = getAuth(context);
    return context.json(
      {
        error: "insufficient_scope",
        required_any: needed,
        granted_scopes: auth.scopes,
        granted_permissions: auth.permissions,
      },
      403
    );
  };
}

function normalizeServerConfig(config: ServerConfig): UnknownRecord {
  const baseUrl =
    config.baseUrl === undefined ? undefined : new URL(config.baseUrl);
  const basePath =
    baseUrl !== undefined && baseUrl.pathname !== "/"
      ? baseUrl.pathname.replace(/\/$/, "")
      : undefined;
  const oauth =
    config.oauth === undefined
      ? undefined
      : {
          ...config.oauth,
          ...(config.oauth.resource === undefined && baseUrl !== undefined
            ? { resource: new URL(basePath ?? "/mcp", baseUrl.origin) }
            : {}),
        };
  return {
    name: config.name,
    version: config.version,
    ...(config.title !== undefined && { title: config.title }),
    ...(config.description !== undefined && {
      description: config.description,
    }),
    ...(config.instructions !== undefined && {
      instructions: config.instructions,
    }),
    ...(config.host !== undefined && { host: config.host }),
    ...(config.port !== undefined && { port: config.port }),
    ...(basePath !== undefined && { basePath }),
    ...(config.allowedOrigins !== undefined && {
      allowedHosts: config.allowedOrigins.map(hostnameFromLegacyOrigin),
    }),
    cors: normalizeCors(config.cors),
    ...(oauth !== undefined && { oauth }),
    ...(config.publicLandingPage !== undefined && {
      publicLandingPage: config.publicLandingPage,
    }),
    ...(config.favicon !== undefined && { favicon: config.favicon }),
    ...(config.icons !== undefined && { icons: config.icons }),
    ...(config.websiteUrl !== undefined && { websiteUrl: config.websiteUrl }),
  };
}

function compatAuthFromSdk(authInfo: SdkAuthInfo): AuthInfo {
  const extra = authInfo.extra;
  if (
    extra === undefined ||
    typeof extra !== "object" ||
    extra === null ||
    !("user" in extra) ||
    typeof extra.user !== "object" ||
    extra.user === null ||
    Array.isArray(extra.user) ||
    !("payload" in extra) ||
    typeof extra.payload !== "object" ||
    extra.payload === null ||
    Array.isArray(extra.payload) ||
    !("permissions" in extra) ||
    !Array.isArray(extra.permissions) ||
    !extra.permissions.every((permission) => typeof permission === "string")
  ) {
    throw new Error("Authentication context is missing mapped OAuth data.");
  }
  const user = extra.user as UnknownRecord;
  const id = user["userId"] ?? user["id"];
  return {
    user: {
      ...user,
      ...(typeof id === "string" && { userId: id }),
      permissions: [...extra.permissions],
      scopes: [...authInfo.scopes],
    } as UserInfo,
    payload: extra.payload as UnknownRecord,
    accessToken: authInfo.token,
    scopes: [...authInfo.scopes],
    permissions: [...extra.permissions],
  };
}

function normalizeCors(cors: CorsOptions | undefined): UnknownRecord {
  if (cors === undefined) return { origin: "*" };
  return {
    ...(cors.origin !== undefined && { origin: cors.origin }),
    ...(cors.allowMethods !== undefined && { methods: cors.allowMethods }),
    ...(cors.allowHeaders !== undefined && {
      allowedHeaders: cors.allowHeaders,
    }),
    ...(cors.credentials !== undefined && { credentials: cors.credentials }),
  };
}

function hostnameFromLegacyOrigin(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value.split(":")[0] ?? value;
  }
}

function assertSupportedConfig(config: ServerConfig): void {
  if (config.stateless === false) {
    throw unsupported("stateless: false", "v2 is stateless");
  }
  for (const [name, value] of [
    ["sessionIdleTimeoutMs", config.sessionIdleTimeoutMs],
    ["autoCreateSessionOnInvalidId", config.autoCreateSessionOnInvalidId],
    ["sessionStore", config.sessionStore],
    ["streamManager", config.streamManager],
  ] as const) {
    if (value !== undefined) throw unsupported(name, "migrate to stateless v2");
  }
}

function decorateContext<TEnv extends Env>(
  ctx: RequestContext<unknown, true, TEnv>
): UnknownRecord {
  const mutable = ctx as unknown as UnknownRecord;
  const client = ctx.client as RequestClientContext & {
    supportsApps?: () => boolean;
  };
  client.supportsApps ??= () => client.supportsViews();
  mutable["log"] = ctx.sendLog.bind(ctx);
  const auth = mutable["auth"];
  if (auth !== undefined && typeof auth === "object" && auth !== null) {
    const typed = auth as {
      user: UnknownRecord;
      scopes: string[];
      permissions: string[];
    };
    const user = typed.user;
    const id = user["userId"] ?? user["id"];
    typed.user = {
      ...user,
      ...(typeof id === "string" && { userId: id }),
      ...(user["organizationId"] !== undefined && {
        organization_id: user["organizationId"],
        org_id: user["organizationId"],
      }),
      ...(user["organizationRole"] !== undefined && {
        org_role: user["organizationRole"],
      }),
      ...(user["organizationSlug"] !== undefined && {
        org_slug: user["organizationSlug"],
      }),
      permissions: [...typed.permissions],
      scopes: [...typed.scopes],
    };
  }
  return mutable;
}

function metadataSchema(
  metadata: LegacyWidgetMetadata | undefined
): StandardSchemaWithJSON | undefined {
  const schema = metadata?.props ?? metadata?.schema ?? metadata?.inputs;
  return isStandardSchema(schema) ? schema : undefined;
}

function isStandardSchema(value: unknown): value is StandardSchemaWithJSON {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as { "~standard"?: { validate?: unknown } })["~standard"]
      ?.validate === "function"
  );
}

const passthroughObjectSchema: StandardSchemaWithJSON<
  UnknownRecord,
  UnknownRecord
> = {
  "~standard": {
    version: 1,
    vendor: "mcp-use-v1-compat",
    validate(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { issues: [{ message: "expected an object" }] };
      }
      return { value: value as UnknownRecord };
    },
    jsonSchema: {
      input: () => ({ type: "object", additionalProperties: true }),
      output: () => ({ type: "object", additionalProperties: true }),
    },
  },
};

function legacyViewConfig(
  name: string,
  metadata: LegacyWidgetMetadata | undefined
): ToolViewConfig {
  const unified = metadata?.metadata;
  const apps = metadata?.appsSdkMetadata;
  const appsCsp = apps?.["openai/widgetCSP"];
  const csp =
    unified?.csp ??
    (appsCsp === undefined
      ? undefined
      : {
          ...(appsCsp.connect_domains !== undefined && {
            connectDomains: appsCsp.connect_domains,
          }),
          ...(appsCsp.resource_domains !== undefined && {
            resourceDomains: appsCsp.resource_domains,
          }),
          ...(appsCsp.frame_domains !== undefined && {
            frameDomains: appsCsp.frame_domains,
          }),
        });
  const description =
    unified?.description ??
    metadata?.description ??
    apps?.["openai/widgetDescription"];
  const prefersBorder =
    unified?.prefersBorder ?? apps?.["openai/widgetPrefersBorder"];
  const domain = unified?.domain ?? apps?.["openai/widgetDomain"];
  return {
    name,
    ...(description !== undefined && { description }),
    ...(csp !== undefined && { csp }),
    ...(prefersBorder !== undefined && { prefersBorder }),
    ...(domain !== undefined && { domain }),
  };
}

function legacyInvocationMeta(
  widgetConfig: ToolWidgetConfig | undefined,
  metadata: LegacyWidgetMetadata | undefined
): UnknownRecord | undefined {
  const invoking = widgetConfig?.invoking ?? metadata?.metadata?.invoking;
  const invoked = widgetConfig?.invoked ?? metadata?.metadata?.invoked;
  const accessible = widgetConfig?.widgetAccessible;
  const canProduce = widgetConfig?.resultCanProduceWidget;
  if (
    invoking === undefined &&
    invoked === undefined &&
    accessible === undefined &&
    canProduce === undefined
  ) {
    return undefined;
  }
  return {
    ...(invoking !== undefined && {
      "openai/toolInvocation/invoking": invoking,
    }),
    ...(invoked !== undefined && { "openai/toolInvocation/invoked": invoked }),
    ...(accessible !== undefined && { "openai/widgetAccessible": accessible }),
    ...(canProduce !== undefined && {
      "openai/resultCanProduceWidget": canProduce,
    }),
  };
}

function warnCompat(): void {
  if (warned) return;
  warned = true;
  if (typeof process.emitWarning === "function") {
    process.emitWarning(COMPAT_MESSAGE, {
      type: "DeprecationWarning",
      code: COMPAT_CODE,
    });
  } else {
    console.warn(`[${COMPAT_CODE}] ${COMPAT_MESSAGE}`);
  }
}

function unsupported(feature: string, replacement: string): Error {
  return new Error(
    `[${COMPAT_CODE}] ${feature} is not supported by the temporary v1 compatibility entry; ${replacement}.`
  );
}
