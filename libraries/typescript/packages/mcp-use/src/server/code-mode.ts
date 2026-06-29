import { z } from "zod";
import type { AuthContext } from "./oauth/types.js";
import { evaluateAuthRequirement } from "./middleware/policy.js";
import type {
  McpMiddlewareFn,
  MiddlewareContext,
} from "./middleware/mcp-middleware.js";
import type { ClientCapabilityChecker } from "./types/context.js";
import type {
  EnhancedToolContext,
  ToolCallback,
  ToolDefinition,
} from "./types/tool.js";
import { object, text } from "./utils/response-helpers.js";

const SEARCH_TOOLS_NAME = "search_tools";
const EXECUTE_JS_NAME = "execute_js";
const CODE_MODE_TOOL_NAMES = new Set([SEARCH_TOOLS_NAME, EXECUTE_JS_NAME]);

export interface CodeModeToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: unknown;
  _meta?: Record<string, unknown>;
}

export interface CodeModeContext {
  authContext?: AuthContext;
  client?: ClientCapabilityChecker;
  session?: { sessionId?: string; id?: string };
  requestMeta?: Record<string, unknown>;
}

export interface CodeModeExecuteRequest {
  code: string;
  tools: CodeModeToolDescriptor[];
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface CodeModeSearchRequest {
  query?: string;
  limit?: number;
  tools: CodeModeToolDescriptor[];
}

export interface CodeModeSandboxBackend {
  id?: string;
  execute(
    request: CodeModeExecuteRequest,
    ctx: CodeModeContext
  ): Promise<unknown>;
  search?(
    request: CodeModeSearchRequest,
    ctx: CodeModeContext
  ): Promise<unknown>;
}

export interface CodeModeToolPolicy {
  include?: string[];
  exclude?: string[];
}

export interface EnableCodeModeOptions {
  activate: boolean | ((ctx: CodeModeContext) => boolean | Promise<boolean>);
  tools?: CodeModeToolPolicy;
  sandbox: CodeModeSandboxBackend;
}

interface CodeModeServerLike {
  tool(
    definition: ToolDefinition,
    callback: ToolCallback<
      Record<string, unknown>,
      Record<string, unknown>,
      boolean
    >
  ): unknown;
  _registerMcpMiddleware(pattern: string, handler: McpMiddlewareFn): void;
  convertZodSchemaToParams?(schema: z.ZodTypeAny): Record<string, unknown>;
  registrations: {
    tools: Map<string, { config: ToolDefinition; handler: ToolCallback }>;
  };
}

function toolError(message: string, code = "forbidden") {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
    _meta: {
      "mcp-use/code-mode": { code },
    },
  };
}

function toCodeModeContext(
  ctx: MiddlewareContext | EnhancedToolContext<boolean>
): CodeModeContext {
  const session = (ctx as any).session;
  return {
    authContext: (ctx as any).authContext,
    client: (ctx as any).client,
    session,
    requestMeta: (ctx as MiddlewareContext).requestMeta,
  };
}

async function isCodeModeActive(
  options: EnableCodeModeOptions,
  ctx: CodeModeContext
): Promise<boolean> {
  return typeof options.activate === "function"
    ? await options.activate(ctx)
    : options.activate;
}

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return name === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`).test(name);
}

function isAllowedByToolPolicy(
  name: string,
  policy: CodeModeToolPolicy | undefined
): boolean {
  if (CODE_MODE_TOOL_NAMES.has(name)) return false;
  if (policy?.include?.length) {
    if (!policy.include.some((pattern) => matchesPattern(name, pattern))) {
      return false;
    }
  }
  if (policy?.exclude?.some((pattern) => matchesPattern(name, pattern))) {
    return false;
  }
  return true;
}

async function getAllowedTools(
  server: CodeModeServerLike,
  options: EnableCodeModeOptions,
  ctx: CodeModeContext,
  input?: Record<string, unknown>,
  includePredicate = false
): Promise<CodeModeToolDescriptor[]> {
  const tools: CodeModeToolDescriptor[] = [];
  for (const [name, registration] of server.registrations.tools) {
    if (!isAllowedByToolPolicy(name, options.tools)) continue;

    const decision = await evaluateAuthRequirement(
      registration.config.auth,
      {
        kind: "tool",
        operation: "tools/call",
        name,
        input,
        auth: ctx.authContext,
      },
      { includePredicate }
    );
    if (!decision.allow) continue;

    tools.push({
      name,
      title: registration.config.title,
      description: registration.config.description,
      inputSchema: registration.config.schema
        ? server.convertZodSchemaToParams?.(registration.config.schema)
        : undefined,
      annotations: registration.config.annotations,
      _meta: registration.config._meta,
    });
  }
  return tools;
}

function searchTools(request: CodeModeSearchRequest): {
  tools: CodeModeToolDescriptor[];
  total: number;
} {
  const query = request.query?.trim().toLowerCase();
  const limit = request.limit ?? 20;
  const tools = query
    ? request.tools.filter((tool) =>
        [tool.name, tool.title, tool.description]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      )
    : request.tools;
  return { tools: tools.slice(0, limit), total: tools.length };
}

async function callBackingTool(
  server: CodeModeServerLike,
  options: EnableCodeModeOptions,
  ctx: EnhancedToolContext<boolean>,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const registration = server.registrations.tools.get(name);
  if (!registration || !isAllowedByToolPolicy(name, options.tools)) {
    throw new Error(`Tool "${name}" is not available in code mode`);
  }

  const decision = await evaluateAuthRequirement(
    registration.config.auth,
    {
      kind: "tool",
      operation: "tools/call",
      name,
      input: args,
      auth: (ctx as any).authContext,
    },
    { includePredicate: true }
  );
  if (!decision.allow) {
    throw new Error(decision.message ?? "Access denied");
  }

  return registration.handler.length >= 2
    ? await (registration.handler as any)(args, ctx)
    : await (registration.handler as any)(args);
}

function toToolResult(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).content)
  ) {
    return result as any;
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return object(result as Record<string, unknown>);
  }
  return text(String(result ?? ""));
}

function withoutCodeModeTools(result: unknown) {
  const tools = Array.isArray(result) ? result : ((result as any)?.tools ?? []);
  const filtered = tools.filter(
    (tool: any) => !CODE_MODE_TOOL_NAMES.has(tool.name)
  );
  return Array.isArray(result)
    ? filtered
    : { ...(result as any), tools: filtered };
}

function onlyCodeModeTools(result: unknown) {
  const tools = Array.isArray(result) ? result : ((result as any)?.tools ?? []);
  const filtered = tools.filter((tool: any) =>
    CODE_MODE_TOOL_NAMES.has(tool.name)
  );
  return Array.isArray(result)
    ? filtered
    : { ...(result as any), tools: filtered };
}

/**
 * Register server-native code mode as a policy-gated adapter over tools/list
 * and tools/call. The framework never executes JavaScript itself; callers must
 * provide a sandbox backend that owns isolation, limits, and runtime behavior.
 */
export function enableServerCodeMode(
  server: CodeModeServerLike,
  options: EnableCodeModeOptions
): void {
  if (!options.sandbox?.execute) {
    throw new Error("server.enableCodeMode requires a sandbox backend");
  }

  server.tool(
    {
      name: SEARCH_TOOLS_NAME,
      title: "Search Tools",
      description: "Search the internal tool catalog available to code mode.",
      schema: z.object({
        query: z
          .string()
          .optional()
          .describe("Text to match against tool names and descriptions"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum tools to return"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { "mcp-use/code-mode": true },
    },
    async ({ query, limit }, ctx) => {
      const codeModeCtx = toCodeModeContext(ctx);
      if (!(await isCodeModeActive(options, codeModeCtx))) {
        return toolError(
          "Code mode is not active for this request",
          "inactive"
        );
      }
      const tools = await getAllowedTools(server, options, codeModeCtx);
      const request = {
        query: query as string | undefined,
        limit: limit as number | undefined,
        tools,
      };
      const result = options.sandbox.search
        ? await options.sandbox.search(request, codeModeCtx)
        : searchTools(request);
      return toToolResult(result);
    }
  );

  server.tool(
    {
      name: EXECUTE_JS_NAME,
      title: "Execute JavaScript",
      description:
        "Execute JavaScript inside the configured code-mode sandbox.",
      schema: z.object({
        code: z
          .string()
          .describe("JavaScript source to execute in the configured sandbox"),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
      _meta: { "mcp-use/code-mode": true },
    },
    async ({ code }, ctx) => {
      const codeModeCtx = toCodeModeContext(ctx);
      if (!(await isCodeModeActive(options, codeModeCtx))) {
        return toolError(
          "Code mode is not active for this request",
          "inactive"
        );
      }
      const tools = await getAllowedTools(server, options, codeModeCtx);
      const result = await options.sandbox.execute(
        {
          code: String(code),
          tools,
          callTool: (name, args) =>
            callBackingTool(server, options, ctx, name, args),
        },
        codeModeCtx
      );
      return toToolResult(result);
    }
  );

  server._registerMcpMiddleware("tools/list", async (ctx, next) => {
    const result = await next();
    return (await isCodeModeActive(options, toCodeModeContext(ctx)))
      ? onlyCodeModeTools(result)
      : withoutCodeModeTools(result);
  });

  server._registerMcpMiddleware("tools/call", async (ctx, next) => {
    const name = ctx.toolName;
    if (!name) return next();

    const active = await isCodeModeActive(options, toCodeModeContext(ctx));
    if (CODE_MODE_TOOL_NAMES.has(name)) {
      return active
        ? next()
        : toolError("Code mode is not active for this request", "inactive");
    }
    if (active) {
      return toolError(
        `Tool "${name}" is internal while code mode is active; use ${EXECUTE_JS_NAME} instead`,
        "backing_tool_hidden"
      );
    }
    return next();
  });
}
