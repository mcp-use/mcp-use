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

  /**
   * Maximum number of tokens to generate.
   * Default: 1000 (when using string prompt shorthand).
   * Only used when calling sample() with a string prompt.
   */
  maxTokens?: number;

  /**
   * Model preferences for sampling.
   * Allows specifying which models to use via hints.
   */
  modelPreferences?: {
    hints?: Array<{ name?: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };

  /**
   * System prompt to prepend to the conversation.
   */
  systemPrompt?: string;

  /**
   * Temperature for sampling (0.0 to 1.0).
   * Controls randomness in the response.
   */
  temperature?: number;

  /**
   * Stop sequences to end generation.
   */
  stopSequences?: string[];

  /**
   * Additional metadata to pass with the request.
   */
  metadata?: Record<string, unknown>;
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
   * Supports two calling patterns:
   * 1. **Simplified string API**: Pass a prompt string with optional options
   * 2. **Full control API**: Pass complete CreateMessageRequest params
   *
   * Progress notifications are sent every 5 seconds (configurable) while waiting
   * for the sampling response. This prevents client-side timeouts when the client
   * has `resetTimeoutOnProgress: true` enabled.
   *
   * By default, there is no timeout - the function waits indefinitely for the
   * LLM response. Set `options.timeout` to limit the wait time.
   *
   * @param promptOrParams - Either a string prompt or complete sampling parameters
   * @param options - Optional configuration for timeout, progress, maxTokens, etc.
   * @returns The sampling result from the client's LLM
   *
   * @example
   * ```typescript
   * // Simplified API - just pass a string prompt
   * const result = await ctx.sample("What is the capital of France?");
   *
   * // With options (maxTokens, temperature, etc.)
   * const result = await ctx.sample(
   *   "Analyze this code...",
   *   { maxTokens: 2000, temperature: 0.7 }
   * );
   *
   * // Full control API - complete params object
   * const result = await ctx.sample({
   *   messages: [
   *     { role: 'system', content: { type: 'text', text: 'You are helpful' } },
   *     { role: 'user', content: { type: 'text', text: 'Hello' } }
   *   ],
   *   maxTokens: 1500,
   *   modelPreferences: { hints: [{ name: 'claude-3-5-sonnet' }] }
   * });
   *
   * // With timeout and custom progress handling
   * const result = await ctx.sample(
   *   "Complex task...",
   *   {
   *     timeout: 120000, // 2 minute timeout
   *     progressIntervalMs: 3000, // Report progress every 3 seconds
   *     onProgress: ({ progress, message }) => console.log(message),
   *   }
   * );
   * ```
   */
  sample: {
    // Overload 1: Simplified string API (recommended for simple cases)
    (prompt: string, options?: SampleOptions): Promise<CreateMessageResult>;

    // Overload 2: Full control API (for complex cases)
    (
      params: CreateMessageRequest["params"],
      options?: SampleOptions
    ): Promise<CreateMessageResult>;
  };

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

  /**
   * Send a log notification to the client.
   * Always available - will send notifications if the client supports them.
   *
   * @param level - Log level (debug, info, notice, warning, error, critical, alert, emergency)
   * @param message - Log message content
   * @param logger - Optional logger name (defaults to 'tool')
   *
   * @example
   * ```typescript
   * await ctx.log('info', 'Processing started');
   * await ctx.log('debug', 'Debug details', 'my-tool');
   * await ctx.log('error', 'Something went wrong');
   * ```
   */
  log: (
    level:
      | "debug"
      | "info"
      | "notice"
      | "warning"
      | "error"
      | "critical"
      | "alert"
      | "emergency",
    message: string,
    logger?: string
  ) => Promise<void>;

  /**
   * Client capability interface
   * Provides access to client capabilities advertised during initialization
   */
  client: {
    /**
     * Check if client supports a specific capability
     * @param capability - Capability name (e.g., "sampling", "elicitation", "roots")
     * @returns true if client advertised this capability, false otherwise
     *
     * @example
     * ```typescript
     * if (ctx.client.can('sampling')) {
     *   const result = await ctx.sample('Analyze this');
     * } else {
     *   // Fallback to non-sampling logic
     * }
     * ```
     */
    can(capability: string): boolean;

    /**
     * Get all client capabilities
     * @returns Object containing all capabilities advertised by the client, or empty object if none
     *
     * @example
     * ```typescript
     * const caps = ctx.client.capabilities();
     * console.log(caps);
     * // { sampling: {}, roots: { listChanged: true }, elicitation: { form: {}, url: {} } }
     * ```
     */
    capabilities(): Record<string, any>;
  };

  /**
   * Session information for the current tool execution
   * Provides access to the session ID and other metadata
   */
  session: {
    /**
     * Unique identifier for the current session
     * Can be used with ctx.sendNotificationToSession() to target this session from other tools
     */
    sessionId: string;
  };

  /**
   * Send a notification to the current session (the client that called this tool)
   *
   * This is a convenience method that sends a notification only to the session
   * that initiated the current tool execution. For broadcasting to all sessions,
   * use server.sendNotification() instead.
   *
   * @param method - The notification method name (e.g., "custom/my-notification")
   * @param params - Optional parameters to include in the notification
   * @returns Promise that resolves when the notification is sent
   *
   * @example
   * ```typescript
   * server.tool({
   *   name: 'process_data',
   *   cb: async (params, ctx) => {
   *     // Send progress update to the current session
   *     await ctx.sendNotification('custom/processing', {
   *       status: 'started',
   *       timestamp: Date.now()
   *     });
   *
   *     // Do work...
   *
   *     await ctx.sendNotification('custom/processing', {
   *       status: 'completed'
   *     });
   *
   *     return { content: [{ type: 'text', text: 'Done' }] };
   *   }
   * });
   * ```
   */
  sendNotification: (
    method: string,
    params?: Record<string, unknown>
  ) => Promise<void>;

  /**
   * Send a notification to a specific session by ID
   *
   * This allows sending notifications to any connected session, not just the
   * current one. Useful for cross-session communication or coordinating between
   * multiple clients.
   *
   * @param sessionId - The target session ID (can get from ctx.session.sessionId or server.getActiveSessions())
   * @param method - The notification method name (e.g., "custom/my-notification")
   * @param params - Optional parameters to include in the notification
   * @returns Promise<boolean> - true if notification was sent, false if session not found
   *
   * @example
   * ```typescript
   * server.tool({
   *   name: 'notify_others',
   *   cb: async (params, ctx) => {
   *     const mySessionId = ctx.session.sessionId;
   *
   *     // Notify another specific session
   *     const success = await ctx.sendNotificationToSession(
   *       params.targetSessionId,
   *       'custom/message',
   *       { from: mySessionId, text: 'Hello!' }
   *     );
   *
   *     return {
   *       content: [{
   *         type: 'text',
   *         text: success ? 'Notification sent' : 'Session not found'
   *       }]
   *     };
   *   }
   * });
   * ```
   */
  sendNotificationToSession: (
    sessionId: string,
    method: string,
    params?: Record<string, unknown>
  ) => Promise<boolean>;
}
