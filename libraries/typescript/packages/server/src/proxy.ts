import type {
  CallToolResult,
  GetPromptResult,
  InputRequiredResult,
  JsonSchemaType,
  PromptArgument,
  ReadResourceResult,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type {
  MCPClient as ClientMCPClient,
  MCPConnection as ClientMCPConnection,
  ServerConfig as ClientServerConfig,
} from "@mcp-use/client";

import type { RequestContext } from "./context.js";
import type { PromptCallback, PromptDefinition } from "./prompts.js";
import type { ResourceCallback, ResourceDefinition } from "./resources.js";
import type { ToolCallback, ToolDefinition } from "./tools.js";

/** Automatic OAuth settings forwarded to `@mcp-use/client` v2. */
export interface ProxyOAuthOptions {
  /** Prefix used when persisting OAuth state. */
  storageKeyPrefix?: string;
  /** OAuth client display name. */
  clientName?: string;
  /** OAuth client website URL. */
  clientUri?: string;
  /** OAuth client logo URL. */
  logoUri?: string;
  /** OAuth callback URL override. */
  callbackUrl?: string;
  /** OAuth Client ID Metadata Document URL. */
  clientMetadataUrl?: string;
  /** Space-delimited scopes requested during authorization. */
  scope?: string;
  /** Preferred loopback callback port in Node.js. */
  preferredPort?: number;
  /** Number of additional loopback ports tried after the preferred port. */
  portRange?: number;
  /** Maximum time to wait for OAuth completion in milliseconds. */
  authTimeoutMs?: number;
  /** Browser-opening callback used by Node.js OAuth flows. */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Wait for explicit authentication instead of opening OAuth automatically. */
  preventAutoAuth?: boolean;
  /** Use a full-page redirect instead of a popup in browser environments. */
  useRedirectFlow?: boolean;
  /** Same-origin OAuth proxy base URL for browser environments. */
  oauthProxyUrl?: string;
  /** Route OAuth HTTP requests through `oauthProxyUrl`. */
  proxyOAuthRequests?: boolean;
}

/** HTTP connection settings accepted by {@link MCPServer.proxy}. */
export interface ProxyHttpConfig {
  /** Upstream MCP endpoint URL. */
  url: string;
  /** Extra headers sent on every upstream request. */
  headers?: Record<string, string>;
  /** Bearer token sent to the upstream server. */
  authToken?: string;
  /** Connection timeout in milliseconds. */
  timeout?: number;
  /** Fetch implementation used for upstream HTTP requests. */
  fetch?: typeof fetch;
  /** Disable automatic OAuth, or configure the client's automatic OAuth flow. */
  oauth?: false | ProxyOAuthOptions;
  /** Protocol negotiation mode forwarded to `@mcp-use/client`. */
  protocolNegotiation?: "auto" | "legacy" | { pin: string };
}

/** Node stdio connection settings accepted by {@link MCPServer.proxy}. */
export interface ProxyStdioConfig {
  /** Executable that starts the upstream MCP server. */
  command: string;
  /** Command-line arguments passed to the executable. */
  args: string[];
  /** Environment passed to the child process. */
  env?: Record<string, string>;
  /** Working directory for the child process. */
  cwd?: string;
  /** Protocol negotiation mode forwarded to `@mcp-use/client`. */
  protocolNegotiation?: "auto" | "legacy" | { pin: string };
}

/** Connection settings for one upstream server. */
export type ProxyServerConfig = ProxyHttpConfig | ProxyStdioConfig;

/** Options for mounting an existing {@link ProxyConnection}. */
export interface ProxyOptions {
  /** Prefix applied to mounted capability names. Omit to preserve names. */
  namespace?: string;
}

/** Progress payload received while a proxied tool is running. */
export interface ProxyProgress {
  /** Completed work units. */
  progress: number;
  /** Total work units, when known. */
  total?: number | undefined;
  /** Human-readable progress detail. */
  message?: string | undefined;
}

/** Request controls used when forwarding calls to an upstream connection. */
export interface ProxyRequestOptions {
  /** Aborts the upstream request when the downstream request is cancelled. */
  signal?: AbortSignal;
  /** Receives upstream progress notifications. */
  onprogress?: (progress: ProxyProgress) => void | Promise<void>;
}

/** Structural connection contract accepted by the low-level proxy overload. */
export interface ProxyConnection {
  /** Whether the upstream advertised a named MCP capability. */
  supports?(capability: string): boolean;
  /** List upstream tools. */
  listTools(): Promise<ProxyTool[]>;
  /** Forward a tool call. */
  callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: ProxyRequestOptions
  ): Promise<CallToolResult | InputRequiredResult>;
  /** List upstream resources, including pagination when supported. */
  listAllResources?(): Promise<{ resources: ProxyResource[] }>;
  /** List one page of upstream resources. */
  listResources?(): Promise<{ resources: ProxyResource[] }>;
  /** Read an upstream resource. */
  readResource(
    uri: string,
    options?: ProxyRequestOptions
  ): Promise<ReadResourceResult>;
  /** List upstream prompts. */
  listPrompts(): Promise<{ prompts: ProxyPrompt[] }>;
  /** Render an upstream prompt. */
  getPrompt(
    name: string,
    args: Record<string, unknown>
  ): Promise<GetPromptResult>;
}

/** Tool metadata consumed while introspecting an upstream connection. */
export interface ProxyTool {
  /** Upstream tool name. */
  name: string;
  /** Human-readable tool title. */
  title?: string | undefined;
  /** LLM-facing tool description. */
  description?: string | undefined;
  /** Upstream input JSON Schema. */
  inputSchema?: Record<string, unknown> | undefined;
  /** Upstream output JSON Schema. */
  outputSchema?: Record<string, unknown> | undefined;
  /** Upstream behavioral hints. */
  annotations?: ToolAnnotations | undefined;
}

/** Resource metadata consumed while introspecting an upstream connection. */
export interface ProxyResource {
  /** Upstream resource name. */
  name: string;
  /** Original upstream resource URI. */
  uri: string;
  /** Human-readable resource title. */
  title?: string | undefined;
  /** Human-readable resource description. */
  description?: string | undefined;
  /** Resource media type. */
  mimeType?: string | undefined;
}

/** Prompt metadata consumed while introspecting an upstream connection. */
export interface ProxyPrompt {
  /** Upstream prompt name. */
  name: string;
  /** Human-readable prompt title. */
  title?: string | undefined;
  /** Human-readable prompt description. */
  description?: string | undefined;
  /** String arguments accepted by the prompt. */
  arguments?: PromptArgument[] | undefined;
}

/** Registration surface used while mounting proxied capabilities. @internal */
export interface ProxyMountHost {
  /** Whether the parent server has mounted its handler. */
  isStarted(): boolean;
  /** Whether a tool name is already registered. */
  hasTool(name: string): boolean;
  /** Whether a resource name is already registered. */
  hasResource(name: string): boolean;
  /** Whether a prompt name is already registered. */
  hasPrompt(name: string): boolean;
  /** Register a proxied tool. */
  registerTool(definition: ToolDefinition, callback: ToolCallback): void;
  /** Register a proxied resource. */
  registerResource(
    definition: ResourceDefinition,
    callback: ResourceCallback
  ): void;
  /** Register a proxied prompt. */
  registerPrompt(definition: PromptDefinition, callback: PromptCallback): void;
  /** Track a proxy client owned by the parent server. */
  trackOwner(owner: { close(): Promise<void> }): void;
}

interface ProxyNamespacePlan {
  namespace: string | undefined;
  connection: ProxyConnection;
  tools: ProxyTool[];
  resources: ProxyResource[];
  prompts: ProxyPrompt[];
}

interface ProxyClientPackage {
  MCPClient: typeof ClientMCPClient;
}

type Assert<T extends true> = T;
type _ProxyConfigMatchesClient = Assert<
  ProxyServerConfig extends ClientServerConfig ? true : false
>;
type _ClientConnectionMatchesProxy = Assert<
  ClientMCPConnection extends ProxyConnection ? true : false
>;

const PROXY_CLIENT_INSTALL_HINT = [
  "[mcp-use] server.proxy() requires the optional @mcp-use/client package.",
  "Install it in your project:",
  "",
  "  npm install @mcp-use/client",
].join("\n");

function passthroughJsonSchema(
  schema: Record<string, unknown>
): StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp-use-proxy",
      validate(value) {
        return { value: value as Record<string, unknown> };
      },
      jsonSchema: {
        input: () => schema as JsonSchemaType,
        output: () => schema as JsonSchemaType,
      },
    },
  };
}

function promptArgsToJsonSchema(
  args: PromptArgument[] | undefined
): JsonSchemaType {
  const properties: Record<string, JsonSchemaType> = {};
  const required: string[] = [];
  for (const arg of args ?? []) {
    properties[arg.name] = {
      type: "string",
      ...(arg.description !== undefined && { description: arg.description }),
    };
    if (arg.required === true) required.push(arg.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };
}

function prefixedName(namespace: string | undefined, name: string): string {
  return namespace === undefined ? name : `${namespace}_${name}`;
}

function proxiedResourceUri(
  namespace: string | undefined,
  uri: string
): string {
  if (namespace === undefined) return uri;
  return `mcp-use-proxy:///${encodeURIComponent(namespace)}/${encodeURIComponent(uri)}`;
}

function isConnection(value: unknown): value is ProxyConnection {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ProxyConnection>;
  return (
    typeof candidate.listTools === "function" &&
    typeof candidate.callTool === "function" &&
    typeof candidate.readResource === "function" &&
    typeof candidate.listPrompts === "function" &&
    typeof candidate.getPrompt === "function"
  );
}

function isClientPackageMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    error.message.includes("@mcp-use/client")
  );
}

/** Convert a missing optional-client import into the proxy install error. @internal */
export function proxyClientInstallError(error: unknown): Error | undefined {
  return isClientPackageMissing(error)
    ? new Error(PROXY_CLIENT_INSTALL_HINT, { cause: error })
    : undefined;
}

async function loadProxyClient(
  importer: () => Promise<unknown> = () => import("@mcp-use/client")
): Promise<ProxyClientPackage> {
  try {
    return (await importer()) as ProxyClientPackage;
  } catch (error) {
    const installError = proxyClientInstallError(error);
    if (installError !== undefined) throw installError;
    throw error;
  }
}

function supports(
  connection: ProxyConnection,
  capability: "tools" | "resources" | "prompts"
): boolean {
  return connection.supports?.(capability) !== false;
}

async function introspect(
  namespace: string | undefined,
  connection: ProxyConnection
): Promise<ProxyNamespacePlan> {
  try {
    const tools = supports(connection, "tools")
      ? await connection.listTools()
      : [];
    let resources: ProxyResource[] = [];
    if (supports(connection, "resources")) {
      if (connection.listAllResources !== undefined) {
        resources = (await connection.listAllResources()).resources;
      } else if (connection.listResources !== undefined) {
        resources = (await connection.listResources()).resources;
      }
    }
    const prompts = supports(connection, "prompts")
      ? (await connection.listPrompts()).prompts
      : [];
    return { namespace, connection, tools, resources, prompts };
  } catch (error) {
    const label = namespace ?? "unnamed";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to introspect upstream MCP server "${label}": ${message}`,
      { cause: error }
    );
  }
}

function assertMountable(
  host: ProxyMountHost,
  plans: ProxyNamespacePlan[]
): void {
  const planned = {
    tool: new Set<string>(),
    resource: new Set<string>(),
    prompt: new Set<string>(),
  };

  const assertFree = (
    kind: "tool" | "resource" | "prompt",
    name: string,
    namespace: string | undefined
  ): void => {
    const exists =
      kind === "tool"
        ? host.hasTool(name)
        : kind === "resource"
          ? host.hasResource(name)
          : host.hasPrompt(name);
    if (exists || planned[kind].has(name)) {
      throw new Error(
        `Cannot proxy ${kind} "${name}" from namespace "${namespace ?? "unnamed"}": ` +
          `a ${kind} with that name is already registered.`
      );
    }
    planned[kind].add(name);
  };

  for (const plan of plans) {
    for (const tool of plan.tools) {
      assertFree(
        "tool",
        prefixedName(plan.namespace, tool.name),
        plan.namespace
      );
    }
    for (const resource of plan.resources) {
      assertFree(
        "resource",
        prefixedName(plan.namespace, resource.name),
        plan.namespace
      );
    }
    for (const prompt of plan.prompts) {
      assertFree(
        "prompt",
        prefixedName(plan.namespace, prompt.name),
        plan.namespace
      );
    }
  }
}

function mountPlan(host: ProxyMountHost, plan: ProxyNamespacePlan): void {
  for (const tool of plan.tools) {
    const definition: ToolDefinition = {
      name: prefixedName(plan.namespace, tool.name),
      ...(tool.title !== undefined && { title: tool.title }),
      ...(tool.description !== undefined && { description: tool.description }),
      ...(tool.annotations !== undefined && { annotations: tool.annotations }),
      ...(tool.inputSchema !== undefined && {
        inputSchema: passthroughJsonSchema(tool.inputSchema),
      }),
      ...(tool.outputSchema !== undefined && {
        outputSchema: passthroughJsonSchema(tool.outputSchema),
      }),
    };
    const upstreamName = tool.name;
    const callback = async (
      params: Record<string, unknown>,
      ctx: RequestContext
    ) =>
      plan.connection.callTool(upstreamName, params, {
        signal: ctx.signal,
        onprogress: async (progress) => {
          await ctx.reportProgress(
            progress.progress,
            progress.total,
            progress.message
          );
        },
      });
    host.registerTool(definition, callback as ToolCallback);
  }

  for (const resource of plan.resources) {
    const upstreamUri = resource.uri;
    host.registerResource(
      {
        name: prefixedName(plan.namespace, resource.name),
        uri: proxiedResourceUri(plan.namespace, upstreamUri),
        ...(resource.title !== undefined && { title: resource.title }),
        ...(resource.description !== undefined && {
          description: resource.description,
        }),
        ...(resource.mimeType !== undefined && {
          mimeType: resource.mimeType,
        }),
      },
      async (_uri, ctx) =>
        plan.connection.readResource(upstreamUri, { signal: ctx.signal })
    );
  }

  for (const prompt of plan.prompts) {
    const upstreamName = prompt.name;
    host.registerPrompt(
      {
        name: prefixedName(plan.namespace, prompt.name),
        ...(prompt.title !== undefined && { title: prompt.title }),
        ...(prompt.description !== undefined && {
          description: prompt.description,
        }),
        schema: passthroughJsonSchema(promptArgsToJsonSchema(prompt.arguments)),
      },
      async (params) => plan.connection.getPrompt(upstreamName, params)
    );
  }
}

/**
 * Mount one existing upstream connection on a parent server.
 *
 * @param host - Parent server registration surface.
 * @param connection - Ready `@mcp-use/client` v2 connection.
 * @param options - Optional namespace applied to mounted names.
 *
 * @internal
 */
export async function mountProxyConnection(
  host: ProxyMountHost,
  connection: ProxyConnection,
  options: ProxyOptions = {}
): Promise<void> {
  if (host.isStarted()) {
    throw new Error(
      "Cannot call proxy() after the server has started: register upstream servers before listen()/getHandler()."
    );
  }
  const plan = await introspect(options.namespace, connection);
  assertMountable(host, [plan]);
  mountPlan(host, plan);
}

/**
 * Connect and mount namespace-keyed upstream servers through
 * `@mcp-use/client` v2.
 *
 * @param host - Parent server registration surface.
 * @param servers - Namespace-keyed upstream client configuration.
 *
 * @internal
 */
export async function mountProxyServers(
  host: ProxyMountHost,
  servers: Record<string, ProxyServerConfig>
): Promise<void> {
  if (host.isStarted()) {
    throw new Error(
      "Cannot call proxy() after the server has started: register upstream servers before listen()/getHandler()."
    );
  }

  const { MCPClient } = await loadProxyClient();
  const owner = new MCPClient({ mcpServers: servers });
  try {
    const connected: Record<string, ClientMCPConnection> =
      await owner.connectAll();
    const plans: ProxyNamespacePlan[] = [];
    for (const [namespace, connection] of Object.entries(connected)) {
      plans.push(await introspect(namespace, connection));
    }
    assertMountable(host, plans);
    for (const plan of plans) mountPlan(host, plan);
    host.trackOwner(owner);
  } catch (error) {
    await owner.close().catch(() => undefined);
    throw error;
  }
}

/** Determine whether a proxy argument is an existing connection. @internal */
export function isProxyConnection(value: unknown): value is ProxyConnection {
  return isConnection(value);
}
