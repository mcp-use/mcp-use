import type { z } from "zod";
import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type {
  EnhancedPromptContext,
  PromptDefinition,
  PromptCallback,
} from "../types/index.js";
import type { SessionData } from "../sessions/index.js";
import { convertToolResultToPromptResult } from "./conversion.js";

interface PromptServerContext {
  nativeServer: {
    registerPrompt(
      name: string,
      metadata: {
        title?: string;
        description: string;
        argsSchema: z.ZodObject | Record<string, z.ZodSchema> | undefined;
      },
      getPromptCallback: (
        params: Record<string, unknown>,
        extra?: unknown
      ) => Promise<GetPromptResult>
    ): void;
  };
  registeredPrompts: string[];
  sessions?: Map<string, SessionData>;
  convertZodSchemaToParams: (
    schema: z.ZodObject
  ) => Record<string, z.ZodSchema>;
}

/**
 * Define a prompt template
 *
 * Registers a prompt template with the MCP server that clients can use to generate
 * structured prompts for AI models. Prompts can use the same response helpers
 * as tools (text(), object(), markdown(), etc.) for a unified API.
 *
 * @param promptDefinition - Configuration object containing prompt metadata
 * @param promptDefinition.name - Unique identifier for the prompt template
 * @param promptDefinition.description - Human-readable description of the prompt's purpose
 * @param promptDefinition.schema - Zod object schema for input validation
 * @param callback - Async callback that returns prompt messages or response helpers
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.prompt(
 *   {
 *     name: 'code-review',
 *     description: 'Generates a code review prompt',
 *     schema: z.object({ language: z.string(), code: z.string() })
 *   },
 *   async ({ language, code }) => text(`Please review this ${language} code:\n\n${code}`)
 * )
 * ```
 */
export function registerPrompt(
  this: PromptServerContext,
  promptDefinition: PromptDefinition,
  callback: PromptCallback
): PromptServerContext {
  const argsSchema = promptDefinition.schema
    ? this.convertZodSchemaToParams(promptDefinition.schema)
    : undefined;

  // Wrap the callback to support both CallToolResult and GetPromptResult
  const wrappedCallback = async (
    params: Record<string, unknown>,
    extra?: unknown
  ): Promise<GetPromptResult> => {
    // Get the HTTP request context from AsyncLocalStorage
    const { getRequestContext, runWithContext } =
      await import("../context-storage.js");
    const { findSessionContext, createClientCapabilityChecker } =
      await import("../tools/tool-execution-helpers.js");

    const initialRequestContext = getRequestContext();

    // Find session context
    const sessions = this.sessions ?? new Map<string, SessionData>();
    const { requestContext, session } = findSessionContext(
      sessions,
      initialRequestContext,
      undefined,
      undefined
    );

    // Create enhanced context with client capability checker.
    // Use Object.defineProperty to ensure the own property is created even
    // when the Hono Context prototype has a non-writable or accessor property.
    const enhancedContext = (
      requestContext ? Object.create(requestContext) : {}
    ) as EnhancedPromptContext;
    Object.defineProperty(enhancedContext, "client", {
      value: createClientCapabilityChecker(
        session?.clientCapabilities,
        session?.clientInfo
      ),
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // Execute callback with context
    const callbackWithOptionalContext = callback as (
      params: Record<string, unknown>,
      ctx?: EnhancedPromptContext
    ) => ReturnType<PromptCallback>;
    const executeCallback = async () => {
      if (callback.length >= 2) {
        return await callbackWithOptionalContext(params, enhancedContext);
      }
      return await callbackWithOptionalContext(params);
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

  this.nativeServer.registerPrompt(
    promptDefinition.name,
    {
      title: promptDefinition.title,
      description: promptDefinition.description ?? "",
      argsSchema,
    },
    wrappedCallback
  );

  this.registeredPrompts.push(promptDefinition.name);
  return this;
}
