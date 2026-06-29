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
  CallToolResult,
  ElicitRequest,
} from "@modelcontextprotocol/server";
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
interface ToolServerContext<_HasOAuth extends boolean = false> {
  /** Official MCP Server instance */
  nativeServer: {
    registerTool: (
      name: string,
      config: Record<string, unknown>,
      handler: (
        params: Record<string, unknown>,
        extra?: {
          _meta?: { progressToken?: number };
          sendNotification?: (notification: {
            method: string;
            params: Record<string, unknown>;
          }) => Promise<void>;
        }
      ) => Promise<CallToolResult>
    ) => void;
    server: {
      createMessage: (
        params: CreateMessageRequest["params"],
        options?: { timeout?: number }
      ) => Promise<CreateMessageResult>;
      elicitInput: (
        params: ElicitRequest["params"],
        options?: { timeout?: number }
      ) => Promise<ElicitResult>;
    };
  };
  /** Sessions map */
  sessions: Map<string, SessionData>;
  /** Registered tools list */
  registeredTools: string[];
  /** Convert Zod schema to params */
  convertZodSchemaToParams(schema: z.ZodTypeAny): Record<string, z.ZodSchema>;
  /** Create message for sampling */
  createMessage(
    params: CreateMessageRequest["params"],
    options?: { timeout?: number }
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
 * @param toolDefinition - Configuration object containing tool metadata
 * @param toolDefinition.name - Unique identifier for the tool
 * @param toolDefinition.description - Optional human-readable description of what the tool does
 * @param toolDefinition.schema - Zod object schema for input validation
 * @param toolDefinition.outputSchema - Zod object schema for structured output validation
 * @param callback - Async callback function that executes the tool logic
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.tool({
 *   name: 'calculate',
 *   description: 'Performs mathematical calculations',
 *   schema: z.object({
 *     expression: z.string(),
 *     precision: z.number().optional()
 *   }),
 * }, async ({ expression, precision = 2 }) => {
 *   const result = eval(expression)
 *   return text(`Result: ${result.toFixed(precision)}`)
 * })
 *
 * server.tool({
 *   name: 'greet',
 *   schema: z.object({ name: z.string().describe("The name to greet") }),
 * }, async ({ name }) => text(`Hello, ${name}!`))
 * ```
 */
export function toolRegistration<
  T extends ToolDefinition<any, any, boolean>,
  TContext extends ToolServerContext<boolean>,
>(
  this: TContext,
  toolDefinition: T,
  callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>, boolean>
): TContext {
  const inputSchema: z.ZodTypeAny | Record<string, z.ZodSchema> =
    toolDefinition.schema ?? {};

  this.nativeServer.registerTool(
    toolDefinition.name,
    {
      title: toolDefinition.title,
      description: toolDefinition.description ?? "",
      inputSchema,
      ...(toolDefinition.outputSchema
        ? { outputSchema: toolDefinition.outputSchema }
        : {}),
      annotations: toolDefinition.annotations,
      _meta: toolDefinition._meta,
    },
    async (
      params: Record<string, unknown>,
      extra?: {
        _meta?: { progressToken?: number };
        sendNotification?: (notification: {
          method: string;
          params: Record<string, unknown>;
        }) => Promise<void>;
      }
    ) => {
      // Get the HTTP request context from AsyncLocalStorage
      const initialRequestContext = getRequestContext();

      // Extract progress token from request metadata
      const extraProgressToken = extra?._meta?.progressToken;
      const extraSendNotification = extra?.sendNotification;

      // Find session context and extract metadata
      const { requestContext, session, progressToken, sendNotification } =
        findSessionContext(
          this.sessions,
          initialRequestContext,
          extraProgressToken,
          extraSendNotification
        );

      // Extract sessionId from sessions Map
      let sessionId: string | undefined;
      if (session) {
        for (const [sid, s] of this.sessions.entries()) {
          if (s === session) {
            sessionId = sid;
            break;
          }
        }
      }

      // Build request-level user meta from extra._meta (strip SDK-internal progressToken).
      const requestMeta =
        extra?._meta &&
        Object.keys(extra._meta).some((k) => k !== "progressToken")
          ? (Object.fromEntries(
              Object.entries(extra._meta).filter(([k]) => k !== "progressToken")
            ) as Record<string, unknown>)
          : undefined;

      // Create enhanced context with sample, elicit, and reportProgress methods
      const enhancedContext = createEnhancedContext(
        requestContext,
        this.createMessage.bind(this),
        this.nativeServer.server.elicitInput.bind(this.nativeServer.server),
        progressToken,
        sendNotification,
        session?.logLevel,
        session?.clientCapabilities,
        sessionId,
        this.sessions,
        session?.clientInfo,
        requestMeta
      );

      // Execute callback
      const executeCallback = async () => {
        if (callback.length >= 2) {
          return await (callback as any)(params, enhancedContext);
        }
        return await (callback as any)(params);
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
