/**
 * Tool Registration
 *
 * This module handles the registration of tools with the MCP server.
 * Tools are functions that can be called by clients with parameters.
 */

import type { z } from "zod";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { runWithContext, getRequestContext } from "../context-storage.js";
import type {
  ToolDefinition,
  ToolCallback,
  InferToolInput,
  InferToolOutput,
} from "../types/index.js";
import {
  type SessionData,
  findSessionContext,
  createEnhancedContext,
} from "./tool-execution-helpers.js";

/**
 * Interface representing the server context needed for tool registration
 */
export interface ToolServerContext<_HasOAuth extends boolean = false> {
  /** Official MCP Server instance */
  server: {
    registerTool: (
      name: string,
      config: any,
      handler: (params: any, extra?: any) => Promise<any>
    ) => void;
    server: {
      createMessage: (
        params: any,
        options?: any
      ) => Promise<CreateMessageResult>;
      elicitInput: (params: any, options?: any) => Promise<ElicitResult>;
    };
  };
  /** Sessions map */
  sessions: Map<string, SessionData>;
  /** Registered tools list */
  registeredTools: string[];
  /** Convert Zod schema to params */
  convertZodSchemaToParams(
    schema: z.ZodObject<any>
  ): Record<string, z.ZodSchema>;
  /** Create params schema from inputs */
  createParamsSchema(inputs: any[]): Record<string, z.ZodSchema>;
  /** Create message for sampling */
  createMessage(
    params: CreateMessageRequest["params"],
    options?: any
  ): Promise<CreateMessageResult>;
}

/**
 * Define a tool that can be called by clients
 *
 * Registers a tool with the MCP server that clients can invoke with parameters.
 * Tools are functions that perform actions, computations, or operations and
 * return results. They accept structured input parameters and return structured output.
 *
 * Supports Apps SDK metadata for ChatGPT integration via the _meta field.
 *
 * @param toolDefinition - Configuration object containing tool metadata and handler function
 * @param toolDefinition.name - Unique identifier for the tool
 * @param toolDefinition.description - Optional human-readable description of what the tool does
 * @param toolDefinition.inputs - Array of input parameter definitions (legacy, use schema instead)
 * @param toolDefinition.schema - Zod object schema for input validation (preferred)
 * @param toolDefinition.outputSchema - Zod object schema for structured output validation
 * @param toolDefinition.cb - Async callback function that executes the tool logic with provided parameters
 * @param toolDefinition._meta - Optional metadata for the tool (e.g. Apps SDK metadata)
 * @param callback - Optional separate callback function (alternative to cb property)
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * // Using Zod schema (preferred)
 * server.tool({
 *   name: 'calculate',
 *   description: 'Performs mathematical calculations',
 *   schema: z.object({
 *     expression: z.string(),
 *     precision: z.number().optional()
 *   }),
 *   cb: async ({ expression, precision = 2 }) => {
 *     const result = eval(expression)
 *     return text(`Result: ${result.toFixed(precision)}`)
 *   }
 * })
 *
 * // Using legacy inputs array
 * server.tool({
 *   name: 'greet',
 *   inputs: [{ name: 'name', type: 'string', required: true }],
 *   cb: async ({ name }) => text(`Hello, ${name}!`)
 * })
 *
 * // With separate callback for better typing
 * server.tool({
 *   name: 'add',
 *   schema: z.object({ a: z.number(), b: z.number() })
 * }, async ({ a, b }) => text(`${a + b}`))
 * ```
 */
export function toolRegistration<
  T extends ToolDefinition<any, any, boolean>,
  TContext extends ToolServerContext<boolean>,
>(
  this: TContext,
  toolDefinition: T,
  callback?: ToolCallback<InferToolInput<T>, InferToolOutput<T>, boolean>
): TContext {
  // Determine which callback to use
  const actualCallback = callback || toolDefinition.cb;

  if (!actualCallback) {
    throw new Error(
      `Tool '${toolDefinition.name}' must have either a cb property or a callback parameter`
    );
  }

  // Determine input schema - prefer schema over inputs
  let inputSchema: Record<string, z.ZodSchema>;

  if (toolDefinition.schema) {
    // Use Zod schema if provided
    inputSchema = this.convertZodSchemaToParams(toolDefinition.schema);
  } else if (toolDefinition.inputs && toolDefinition.inputs.length > 0) {
    // Fall back to inputs array for backward compatibility
    inputSchema = this.createParamsSchema(toolDefinition.inputs);
  } else {
    // No schema defined - empty schema
    inputSchema = {};
  }

  this.server.registerTool(
    toolDefinition.name,
    {
      title: toolDefinition.title,
      description: toolDefinition.description ?? "",
      inputSchema,
      annotations: toolDefinition.annotations,
      _meta: toolDefinition._meta,
    },
    async (params: any, extra?: any) => {
      // Get the HTTP request context from AsyncLocalStorage
      const initialRequestContext = getRequestContext();

      // Extract progress token from request metadata
      const extraProgressToken = extra?._meta?.progressToken;
      const extraSendNotification = extra?.sendNotification;

      // Find session context and extract metadata
      const { requestContext, progressToken, sendNotification } =
        findSessionContext(
          this.sessions,
          initialRequestContext,
          extraProgressToken,
          extraSendNotification
        );

      // Create enhanced context with sample, elicit, and reportProgress methods
      const enhancedContext = createEnhancedContext(
        requestContext,
        this.createMessage.bind(this),
        this.server.server.elicitInput.bind(this.server.server),
        progressToken,
        sendNotification
      );

      // Execute callback
      const executeCallback = async () => {
        if (actualCallback.length >= 2) {
          return await (actualCallback as any)(params, enhancedContext);
        }
        return await (actualCallback as any)(params);
      };

      if (requestContext) {
        return await runWithContext(requestContext, executeCallback);
      }

      return await executeCallback();
    }
  );

  this.registeredTools.push(toolDefinition.name);
  return this;
}
