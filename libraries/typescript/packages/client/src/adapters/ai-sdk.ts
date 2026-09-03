import {
  dynamicTool,
  jsonSchema,
  type Tool as ProviderTool,
  type ToolExecutionOptions,
} from "@ai-sdk/provider-utils";
import type {
  CallToolResult,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import type { MCPConnection } from "../core/session.js";

/** The input shape passed to an MCP tool by the AI SDK. */
export type AiSdkToolInput = Record<string, unknown>;

/** The unmodified MCP result returned from a tool execution. */
export type AiSdkToolOutput = CallToolResult;

/**
 * An AI SDK dynamic tool backed by an MCP tool.
 *
 * The `annotations`, `_meta`, and `metadata` fields are retained as MCP-side
 * metadata. AI SDK only uses the standard tool fields when preparing the tool
 * for a provider.
 */
export type AiSdkTool = ProviderTool<AiSdkToolInput, AiSdkToolOutput> & {
  /** Identifies this as an AI SDK runtime-generated tool. */
  type: "dynamic";
  /** Original MCP tool annotations. */
  annotations?: MCPTool["annotations"];
  /** Original MCP tool metadata. */
  _meta?: MCPTool["_meta"];
  /** Adapter metadata retained for AI SDK/provider consumers. */
  metadata?: Record<string, unknown>;
};

/** A source with the protocol-neutral MCP operations needed by the adapter. */
export type AiSdkToolConnection = Pick<MCPConnection, "listTools" | "callTool">;

/** The JSON-schema view passed to the optional schema transformer. */
export type AiSdkInputSchema = Record<string, unknown>;

/** Options controlling MCP tool discovery, schema normalization, and metadata. */
export interface CreateAiSdkToolsOptions {
  /**
   * Tool definitions to adapt. When omitted, the adapter fetches them with
   * `connection.listTools()`. An explicitly supplied empty array is valid and
   * does not trigger discovery.
   */
  tools?: MCPTool[];
  /**
   * Transforms the MCP input schema before it is normalized and wrapped with
   * `@ai-sdk/provider-utils`'s `jsonSchema` helper.
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
  const result: AiSdkToolSet = {};

  for (const mcpTool of tools) {
    const name = mcpTool.name;
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      throw new Error(`Duplicate MCP tool name: ${name}`);
    }

    const rawInputSchema = mcpTool.inputSchema;
    const transformedInputSchema =
      options.transformInputSchema?.(rawInputSchema) ?? rawInputSchema;
    const normalizedInputSchema = asInputSchema(transformedInputSchema);
    const inputSchema = {
      ...normalizedInputSchema,
      properties: normalizedInputSchema.properties ?? {},
      additionalProperties: false,
    };
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

    const execute = async (
      args: unknown,
      executionOptions: ToolExecutionOptions
    ): Promise<CallToolResult> => {
      executionOptions?.abortSignal?.throwIfAborted();
      return connection.callTool(name, args as AiSdkToolInput, {
        signal: executionOptions?.abortSignal,
      });
    };

    const dynamicDefinition = {
      ...(mcpTool.description !== undefined
        ? { description: mcpTool.description }
        : {}),
      ...(title !== undefined ? { title } : {}),
      inputSchema: jsonSchema(inputSchema as Parameters<typeof jsonSchema>[0]),
      execute,
      metadata,
      ...(mcpTool.annotations !== undefined
        ? { annotations: mcpTool.annotations }
        : {}),
      ...(mcpTool._meta !== undefined ? { _meta: mcpTool._meta } : {}),
    } as Parameters<typeof dynamicTool>[0];

    result[name] = dynamicTool(dynamicDefinition) as AiSdkTool;
  }

  return result;
}

function asInputSchema(schema: unknown): AiSdkInputSchema {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as AiSdkInputSchema;
  }
  return {};
}
