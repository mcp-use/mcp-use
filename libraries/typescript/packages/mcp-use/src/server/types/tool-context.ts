/**
 * Tool Context Types
 *
 * Defines the context object and related types passed to tool callbacks.
 * Provides access to sampling, elicitation, and progress reporting capabilities.
 */

import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * Options for the sample() function in tool context.
 */
export interface SampleOptions {
  /**
   * Timeout in milliseconds for the sampling request.
   * Default: no timeout (Infinity) - waits indefinitely for the LLM response.
   * Set this if you want to limit how long to wait for sampling.
   */
  timeout?: number;

  /**
   * Interval in milliseconds between progress notifications.
   * Default: 5000 (5 seconds).
   * Progress notifications are sent to the client to prevent timeout
   * when the client has resetTimeoutOnProgress enabled.
   */
  progressIntervalMs?: number;

  /**
   * Optional callback called each time a progress notification is sent.
   * Useful for logging or custom progress handling.
   */
  onProgress?: (progress: {
    progress: number;
    total?: number;
    message: string;
  }) => void;
}

/**
 * Options for the elicit() function in tool context.
 */
export interface ElicitOptions {
  /**
   * Timeout in milliseconds for the elicitation request.
   * Default: no timeout (Infinity) - waits indefinitely for user response.
   * Set this if you want to limit how long to wait for user input.
   *
   * @example
   * ```typescript
   * // Wait indefinitely (default)
   * await ctx.elicit(message, schema);
   *
   * // With 2 minute timeout
   * await ctx.elicit(message, schema, { timeout: 120000 });
   * ```
   */
  timeout?: number;
}

/**
 * Parameters for form mode elicitation.
 * Used to request structured data from users with optional JSON schema validation.
 */
export interface ElicitFormParams {
  /** Human-readable message explaining why the information is needed */
  message: string;
  /** JSON Schema defining the structure of the expected response */
  requestedSchema: Record<string, any>;
  /** Mode specifier (optional for backwards compatibility, defaults to "form") */
  mode?: "form";
}

/**
 * Parameters for URL mode elicitation.
 * Used to direct users to external URLs for sensitive interactions.
 * MUST be used for interactions involving sensitive information like credentials.
 */
export interface ElicitUrlParams {
  /** Human-readable message explaining why the interaction is needed */
  message: string;
  /** URL for the user to navigate to */
  url: string;
  /** Mode specifier (required for URL mode) */
  mode: "url";
}

/**
 * Context object passed to tool callbacks.
 * Provides access to sampling, elicitation, and progress reporting capabilities.
 */
export interface ToolContext {
  /**
   * Request sampling from the client's LLM with automatic progress notifications.
   *
   * Progress notifications are sent every 5 seconds (configurable) while waiting
   * for the sampling response. This prevents client-side timeouts when the client
   * has `resetTimeoutOnProgress: true` enabled.
   *
   * By default, there is no timeout - the function waits indefinitely for the
   * LLM response. Set `options.timeout` to limit the wait time.
   *
   * @param params - Sampling parameters (messages, model preferences, etc.)
   * @param options - Optional configuration for timeout and progress
   * @returns The sampling result from the client's LLM
   *
   * @example
   * ```typescript
   * // Basic usage - waits indefinitely with automatic progress notifications
   * const result = await ctx.sample({
   *   messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
   * });
   *
   * // With timeout and custom progress handling
   * const result = await ctx.sample(
   *   { messages: [...] },
   *   {
   *     timeout: 120000, // 2 minute timeout
   *     progressIntervalMs: 3000, // Report progress every 3 seconds
   *     onProgress: ({ progress, message }) => console.log(message),
   *   }
   * );
   * ```
   */
  sample: (
    params: CreateMessageRequest["params"],
    options?: SampleOptions
  ) => Promise<CreateMessageResult>;

  /**
   * Request user input via the client through elicitation.
   *
   * Supports two modes with automatic mode detection:
   * - **Form mode**: Pass a Zod schema as second parameter - collects structured data
   * - **URL mode**: Pass a URL string as second parameter - directs to external URL
   * - **Verbose mode**: Pass an object with explicit mode for backwards compatibility
   *
   * By default, there is no timeout - waits indefinitely for user response.
   * Set `options.timeout` to limit the wait time.
   *
   * @example
   * ```typescript
   * // Form mode (simplified) - automatically inferred from Zod schema
   * const result = await ctx.elicit(
   *   "Please provide your information",
   *   z.object({
   *     name: z.string().default("Anonymous"),
   *     age: z.number().default(0)
   *   })
   * );
   * // result.data is typed as { name: string, age: number }
   *
   * // With timeout
   * const result = await ctx.elicit(
   *   "Enter info",
   *   z.object({ name: z.string() }),
   *   { timeout: 60000 } // 1 minute timeout
   * );
   *
   * // URL mode (simplified) - automatically inferred from URL string
   * const authResult = await ctx.elicit(
   *   "Please authorize access",
   *   "https://example.com/oauth/authorize"
   * );
   *
   * // Verbose API (backwards compatible)
   * const verboseResult = await ctx.elicit({
   *   message: "Please provide your information",
   *   requestedSchema: { type: "object", properties: {...} },
   *   mode: "form"
   * });
   * ```
   */
  elicit: {
    // Overload 1: Form mode with Zod schema (simplified, type-safe)
    <T extends z.ZodObject<any>>(
      message: string,
      schema: T,
      options?: ElicitOptions
    ): Promise<ElicitResult & { data: z.infer<T> }>;

    // Overload 2: URL mode with string URL (simplified)
    (
      message: string,
      url: string,
      options?: ElicitOptions
    ): Promise<ElicitResult>;

    // Overload 3: Original verbose API (backwards compatibility)
    (
      params: ElicitFormParams | ElicitUrlParams,
      options?: ElicitOptions
    ): Promise<ElicitResult>;
  };

  /**
   * Send a progress notification to the client.
   * Only available if the client requested progress updates for this tool call.
   *
   * @param progress - Current progress value (should increase with each call)
   * @param total - Total progress value if known
   * @param message - Optional message describing current progress
   */
  reportProgress?: (
    progress: number,
    total?: number,
    message?: string
  ) => Promise<void>;
}
