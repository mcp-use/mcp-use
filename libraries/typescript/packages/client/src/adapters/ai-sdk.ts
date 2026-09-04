import type {
  CallToolResult,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import type { MCPConnection } from "../core/session.js";

const AI_SDK_SCHEMA_SYMBOL = Symbol.for("vercel.ai.schema");
const AI_SDK_VALIDATOR_SYMBOL = Symbol.for("vercel.ai.validator");

/** The input shape passed to an MCP tool by the AI SDK. */
export type AiSdkToolInput = Record<string, unknown>;

/** The unmodified MCP result returned from a tool execution. */
export type AiSdkToolOutput = CallToolResult;

/** The JSON-schema view passed to the optional schema transformer. */
export type AiSdkInputSchema = Record<string, unknown>;

/** A successful pass-through result for an AI SDK dynamic-tool input. */
export interface AiSdkToolValidationResult {
  /** Confirms that the adapter leaves validation to the MCP server. */
  success: true;
  /** The parsed value passed through to MCP without local schema coercion. */
  value: unknown;
}

/**
 * A JSON Schema wrapper understood by AI SDK dynamic tools.
 *
 * It uses AI SDK's runtime schema and validator markers without importing an
 * AI SDK package. The pass-through validator keeps MCP servers authoritative
 * for input validation while supporting AI SDK v5's validator path.
 */
export interface AiSdkToolSchema {
  /** AI SDK schema type placeholder for runtime-discovered tool inputs. */
  _type: undefined;
  /** The unmodified MCP JSON Schema sent to the AI SDK provider. */
  jsonSchema: AiSdkInputSchema;
  /** Accepts parsed JSON; the MCP server performs authoritative validation. */
  validate(value: unknown): AiSdkToolValidationResult;
}

/** Execution context supplied by supported AI SDK dynamic-tool versions. */
export interface AiSdkToolExecutionOptions {
  /** Cancels the corresponding MCP request when the AI SDK aborts it. */
  abortSignal?: AbortSignal;
}

/**
 * An AI SDK dynamic tool backed by an MCP tool.
 *
 * The `annotations`, `_meta`, and `metadata` fields are retained as MCP-side
 * metadata. The structural type intentionally imports no AI SDK types so the
 * client remains compatible with AI SDK v5, v6, and v7 without a dependency.
 */
export interface AiSdkTool {
  /** Identifies this as an AI SDK runtime-generated tool. */
  type: "dynamic";
  /** MCP tool description supplied to the model, when present. */
  description?: string;
  /** Human-readable MCP tool title, when present. */
  title?: string;
  /**
   * Input schema passed to the AI SDK provider and dynamic-tool parser.
   *
   * `any` is intentional: AI SDK v5, v6, and v7 expose incompatible
   * `FlexibleSchema` generations, while dynamic MCP tool inputs are runtime
   * values in all of them.
   */
  inputSchema: any;
  /** Executes the MCP tool with model-provided arguments. */
  execute(
    args: unknown,
    executionOptions?: AiSdkToolExecutionOptions
  ): Promise<AiSdkToolOutput>;
  /** Original MCP tool annotations. */
  annotations?: MCPTool["annotations"];
  /** Original MCP tool metadata. */
  _meta?: MCPTool["_meta"];
  /** Adapter metadata retained for AI SDK/provider consumers. */
  metadata?: any;
}

/** A source with the protocol-neutral MCP operations needed by the adapter. */
export type AiSdkToolConnection = Pick<MCPConnection, "listTools" | "callTool">;

/** Options controlling MCP tool discovery, schema normalization, and metadata. */
export interface CreateAiSdkToolsOptions {
  /**
   * Tool definitions to adapt. When omitted, the adapter fetches them with
   * `connection.listTools()`. An explicitly supplied empty array is valid and
   * does not trigger discovery.
   */
  tools?: MCPTool[];
  /**
   * Transforms the MCP input schema before it is passed to the AI SDK. The
   * returned schema is preserved exactly; use this only for deliberate
   * application-level compatibility transformations.
   */
  transformInputSchema?: (inputSchema: unknown) => unknown;
  /**
   * Client identity retained in the returned tool metadata. This does not
   * change the already-connected MCP connection's client identity.
   */
  clientName?: string;
}

/** The AI SDK tools keyed by their original MCP tool names. */
export type AiSdkToolSet = Record<string, AiSdkTool>;

/**
 * Creates AI SDK dynamic tools from one protocol-neutral MCP connection.
 *
 * This helper adapts tool definitions and invocation only. It does not own
 * connection creation, authentication, transport lifetime, or cleanup.
 */
export async function createAiSdkTools(
  connection: AiSdkToolConnection,
  options: CreateAiSdkToolsOptions = {}
): Promise<AiSdkToolSet> {
  const tools = options.tools ?? (await connection.listTools());
  const result = Object.create(null) as AiSdkToolSet;

  for (const mcpTool of tools) {
    const name = mcpTool.name;
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      throw new Error(`Duplicate MCP tool name: ${name}`);
    }

    const rawInputSchema = mcpTool.inputSchema;
    const transformedInputSchema =
      options.transformInputSchema?.(rawInputSchema) ?? rawInputSchema;
    const inputSchema = toAiSdkInputSchema(
      asInputSchema(transformedInputSchema)
    );
    const title = mcpTool.title ?? mcpTool.annotations?.title;
    const metadata: Record<string, unknown> = {
      toolName: name,
      ...(options.clientName !== undefined
        ? { clientName: options.clientName }
        : {}),
      ...(title !== undefined ? { title } : {}),
      ...(mcpTool.annotations !== undefined
        ? { annotations: mcpTool.annotations }
        : {}),
      ...(mcpTool._meta !== undefined ? { _meta: mcpTool._meta } : {}),
    };

    const execute: AiSdkTool["execute"] = async (
      args,
      executionOptions = {}
    ) => {
      executionOptions?.abortSignal?.throwIfAborted();
      return connection.callTool(name, args as AiSdkToolInput, {
        signal: executionOptions?.abortSignal,
      });
    };

    const dynamicDefinition: AiSdkTool = {
      type: "dynamic",
      ...(mcpTool.description !== undefined
        ? { description: mcpTool.description }
        : {}),
      ...(title !== undefined ? { title } : {}),
      inputSchema,
      execute,
      metadata,
      ...(mcpTool.annotations !== undefined
        ? { annotations: mcpTool.annotations }
        : {}),
      ...(mcpTool._meta !== undefined ? { _meta: mcpTool._meta } : {}),
    };

    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: dynamicDefinition,
      writable: true,
    });
  }

  return result;
}

function asInputSchema(schema: unknown): AiSdkInputSchema {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as AiSdkInputSchema;
  }
  return {};
}

function toAiSdkInputSchema(jsonSchema: AiSdkInputSchema): AiSdkToolSchema {
  const schema: AiSdkToolSchema & Record<symbol, unknown> = {
    [AI_SDK_SCHEMA_SYMBOL]: true,
    [AI_SDK_VALIDATOR_SYMBOL]: true,
    _type: undefined,
    jsonSchema,
    validate: (value) => ({ success: true, value }),
  };
  return schema;
}
