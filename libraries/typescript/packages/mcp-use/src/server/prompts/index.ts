import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  PromptDefinition,
  PromptDefinitionWithoutCallback,
  PromptCallback,
} from "../types.js";
import { convertToolResultToPromptResult } from "./conversion.js";

export interface PromptServerContext {
  server: {
    registerPrompt(
      name: string,
      metadata: {
        title?: string;
        description: string;
        argsSchema: any;
      },
      getPromptCallback: (params: any) => Promise<GetPromptResult>
    ): void;
  };
  registeredPrompts: string[];
  createParamsSchema: (args: any[]) => any;
  convertZodSchemaToParams: (schema: any) => any;
}

/**
 * Define a prompt template
 *
 * Registers a prompt template with the MCP server that clients can use to generate
 * structured prompts for AI models. Prompts can now use the same response helpers
 * as tools (text(), object(), markdown(), etc.) for a unified API.
 *
 * Supports two patterns:
 * 1. Old API: Single object with cb property
 * 2. New API: Definition object + separate callback (like tools and resources)
 *
 * @param promptDefinition - Configuration object containing prompt metadata
 * @param promptDefinition.name - Unique identifier for the prompt template
 * @param promptDefinition.description - Human-readable description of the prompt's purpose
 * @param promptDefinition.args - Array of argument definitions (legacy, use schema instead)
 * @param promptDefinition.schema - Zod object schema for input validation (preferred)
 * @param callback - Optional separate callback function (new API pattern)
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * // New API: Using response helpers (recommended)
 * server.prompt(
 *   {
 *     name: 'code-review',
 *     description: 'Generates a code review prompt',
 *     schema: z.object({ language: z.string(), code: z.string() })
 *   },
 *   async ({ language, code }) => text(`Please review this ${language} code:\n\n${code}`)
 * )
 *
 * // Old API: Still supported for backward compatibility
 * server.prompt({
 *   name: 'greeting',
 *   args: [{ name: 'name', type: 'string', required: true }],
 *   cb: async ({ name }) => ({
 *     messages: [{
 *       role: 'user',
 *       content: { type: 'text', text: `Hello, ${name}!` }
 *     }]
 *   })
 * })
 * ```
 */
export function registerPrompt(
  this: PromptServerContext,
  promptDefinition: PromptDefinition | PromptDefinitionWithoutCallback,
  callback?: PromptCallback
): PromptServerContext {
  // Determine which callback to use
  const actualCallback = callback || (promptDefinition as PromptDefinition).cb;

  if (!actualCallback) {
    throw new Error(
      `Prompt '${promptDefinition.name}' must have either a cb property or a callback parameter`
    );
  }

  // Determine input schema - prefer schema over args
  let argsSchema: any;
  if ((promptDefinition as any).schema) {
    argsSchema = this.convertZodSchemaToParams(
      (promptDefinition as any).schema
    );
  } else {
    argsSchema = this.createParamsSchema(promptDefinition.args || []);
  }

  // Wrap the callback to support both CallToolResult and GetPromptResult
  const wrappedCallback = async (
    params: any,
    extra?: any
  ): Promise<GetPromptResult> => {
    // Get the HTTP request context from AsyncLocalStorage
    const { getRequestContext, runWithContext } =
      await import("../context-storage.js");
    const { findSessionContext } =
      await import("../tools/tool-execution-helpers.js");

    const initialRequestContext = getRequestContext();

    // Find session context
    const sessions = (this as any).sessions || new Map();
    const { requestContext } = findSessionContext(
      sessions,
      initialRequestContext,
      undefined,
      undefined
    );

    // Create enhanced context (without tool-specific features like sample/elicit/reportProgress)
    const enhancedContext = requestContext || {};

    // Execute callback with context
    const executeCallback = async () => {
      if (actualCallback.length >= 2) {
        return await (actualCallback as any)(params, enhancedContext);
      }
      return await (actualCallback as any)(params);
    };

    const result = requestContext
      ? await runWithContext(requestContext, executeCallback)
      : await executeCallback();

    // If it's already a GetPromptResult, return as-is
    if ("messages" in result && Array.isArray(result.messages)) {
      return result as GetPromptResult;
    }

    // Convert CallToolResult to GetPromptResult
    return convertToolResultToPromptResult(result as CallToolResult);
  };

  this.server.registerPrompt(
    promptDefinition.name,
    {
      title: promptDefinition.title,
      description: promptDefinition.description ?? "",
      argsSchema: argsSchema as any, // Type assertion for Zod v4 compatibility
    },
    wrappedCallback
  );

  this.registeredPrompts.push(promptDefinition.name);
  return this;
}
