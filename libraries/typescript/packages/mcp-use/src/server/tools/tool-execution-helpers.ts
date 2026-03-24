/**
 * Tool Execution Helpers
 *
 * Helper functions for tool execution context enhancement.
 * Extracted from tool-registration.ts to reduce duplication and improve maintainability.
 */

import type { z } from "zod";
import type { Context } from "hono";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  ElicitRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { ElicitationValidationError } from "../../errors.js";
import { generateUUID } from "../utils/runtime.js";
import type {
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
} from "../types/index.js";
import type { SessionData } from "../sessions/session-manager.js";
import { Telemetry } from "../../telemetry/telemetry-node.js";
import { getRequestContext } from "../context-storage.js";

// Re-export SessionData for backwards compatibility
export type { SessionData };

/**
 * Normalized end-user context extracted from per-request metadata.
 *
 * Populated from `params._meta` sent on each `tools/call` request by
 * clients that include user-level context (e.g. ChatGPT via `openai/*` keys).
 * `undefined` on clients that do not send request-level metadata (Inspector,
 * Claude Desktop, CLI, etc.).
 *
 * **Important:** This data is client-reported and **unverified**. Do not treat
 * it as a trusted identity. For verified identity use `ctx.auth` (OAuth).
 *
 * **ChatGPT multi-tenant model:**
 * ChatGPT establishes a single MCP session for all users of a deployed app.
 * The `subject` and `conversationId` fields carry the per-invocation identity
 * that lets you distinguish between callers within that shared session:
 *
 * ```
 * 1 MCP session (ctx.session.sessionId)
 *   N subjects  (ctx.client.user()?.subject)      — one per ChatGPT user account
 *     M threads (ctx.client.user()?.conversationId) — one per chat conversation
 * ```
 */
export interface UserContext {
  /** Browser / host user-agent string (openai/userAgent). */
  userAgent?: string;
  /**
   * BCP-47 locale tag, e.g. `"it-IT"` (openai/locale).
   *
   * **Server-side source:** Detected by ChatGPT from the user's account
   * language settings at session start and attached to each `tools/call`
   * request via HTTP `params._meta`.
   *
   * **Widget equivalent:** Inside a widget, use `useWidget().locale` instead —
   * it normalizes the same preference from two client-side channels:
   * - ChatGPT Apps SDK: `window.openai.locale` (injected into the iframe)
   * - SEP-1865 hosts: `HostContext.locale` (sent via `ui/initialize`)
   *
   * The values are usually identical, but may differ when the user's account
   * language differs from their browser language, or after a locale change
   * mid-session (the `params._meta` value is set at session start; the widget
   * value is fresh at render time).
   */
  locale?: string;
  /** Approximate geographic location of the end user (openai/userLocation). */
  location?: {
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
    latitude?: string;
    longitude?: string;
  };
  /** UTC offset in minutes (timezone_offset_minutes). */
  timezoneOffsetMinutes?: number;
  /**
   * Stable, opaque identifier for the end user (openai/subject).
   * Suitable for per-user personalisation or audit logs.
   * Remains constant across different chat conversations for the same user.
   */
  subject?: string;
  /**
   * Identifier for the current chat / conversation thread (openai/session).
   * Distinct from the MCP session ID (`ctx.session.sessionId`) — this is the
   * host application's conversation thread ID, not the MCP transport session.
   * Changes each time the user starts a new chat conversation.
   */
  conversationId?: string;
}

/**
 * Extract and normalize end-user context from tools/call `params._meta`.
 *
 * Handles the ChatGPT `openai/*` key convention and returns `undefined`
 * when no recognisable user metadata is present.
 */
export function normalizeUserContext(
  rawMeta: Record<string, unknown> | undefined
): UserContext | undefined {
  if (!rawMeta) return undefined;

  const userAgent = rawMeta["openai/userAgent"] as string | undefined;
  const locale = rawMeta["openai/locale"] as string | undefined;
  const rawLocation = rawMeta["openai/userLocation"] as
    | Record<string, unknown>
    | undefined;
  const timezoneOffsetMinutes =
    typeof rawMeta["timezone_offset_minutes"] === "number"
      ? rawMeta["timezone_offset_minutes"]
      : undefined;
  const subject = rawMeta["openai/subject"] as string | undefined;
  const conversationId = rawMeta["openai/session"] as string | undefined;

  const location: UserContext["location"] = rawLocation
    ? {
        city: rawLocation.city as string | undefined,
        region: rawLocation.region as string | undefined,
        country: rawLocation.country as string | undefined,
        timezone: rawLocation.timezone as string | undefined,
        latitude: rawLocation.latitude as string | undefined,
        longitude: rawLocation.longitude as string | undefined,
      }
    : undefined;

  const hasAnyField =
    userAgent !== undefined ||
    locale !== undefined ||
    location !== undefined ||
    timezoneOffsetMinutes !== undefined ||
    subject !== undefined ||
    conversationId !== undefined;

  if (!hasAnyField) return undefined;

  return {
    ...(userAgent !== undefined && { userAgent }),
    ...(locale !== undefined && { locale }),
    ...(location !== undefined && { location }),
    ...(timezoneOffsetMinutes !== undefined && { timezoneOffsetMinutes }),
    ...(subject !== undefined && { subject }),
    ...(conversationId !== undefined && { conversationId }),
  };
}

/**
 * Result of session context lookup
 */
export interface SessionContextResult {
  requestContext: Context | undefined;
  session: SessionData | undefined;
  progressToken: number | undefined;
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
      }) => Promise<void>)
    | undefined;
}

/**
 * Find session context from sessions map
 * Combines session lookup, context matching, and metadata extraction in one pass
 */
export function findSessionContext(
  sessions: Map<string, SessionData>,
  initialRequestContext: Context | undefined,
  extraProgressToken?: number,
  extraSendNotification?: (notification: {
    method: string;
    params: Record<string, any>;
  }) => Promise<void>
): SessionContextResult {
  const requestContext = initialRequestContext;
  let session: SessionData | undefined;
  let progressToken = extraProgressToken;
  let sendNotification = extraSendNotification;

  // Match session by the request context object reference.
  // No fallback scans — returning undefined is safer than returning a random
  // session's data when the correct session cannot be determined.
  if (requestContext) {
    for (const [, s] of sessions.entries()) {
      if (s.context === requestContext) {
        session = s;
        break;
      }
    }
  }

  // Extract missing metadata from session
  if (session) {
    if (!progressToken && session.progressToken) {
      progressToken = session.progressToken;
    }
    if (!sendNotification && session.sendNotification) {
      sendNotification = session.sendNotification;
    }
  }

  return { requestContext, session, progressToken, sendNotification };
}

/**
 * Send a progress notification
 */
export async function sendProgressNotification(
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
      }) => Promise<void>)
    | undefined,
  progressToken: number | undefined,
  progress: number,
  total: number | undefined,
  message: string | undefined
): Promise<void> {
  if (sendNotification && progressToken !== undefined) {
    try {
      await sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress,
          total,
          message,
        },
      });
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number | undefined,
  errorMessage: string
): Promise<T> {
  if (timeout && timeout !== Infinity) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeout);
    });
    return await Promise.race([promise, timeoutPromise]);
  }

  return await promise;
}

/**
 * Parsed elicit parameters
 */
export interface ParsedElicitParams {
  sdkParams: ElicitRequestFormParams | ElicitRequestURLParams;
  zodSchema: z.ZodObject<any> | null;
  options: ElicitOptions | undefined;
}

/**
 * Parse elicit() method parameters handling multiple overload signatures
 */
export function parseElicitParams(
  messageOrParams: string | ElicitFormParams | ElicitUrlParams,
  schemaOrUrlOrOptions?: z.ZodObject<any> | string | ElicitOptions,
  maybeOptions?: ElicitOptions
): ParsedElicitParams {
  let sdkParams: ElicitRequestFormParams | ElicitRequestURLParams;
  let zodSchema: z.ZodObject<any> | null = null;
  let options: ElicitOptions | undefined;

  if (typeof messageOrParams === "string") {
    const message = messageOrParams;

    if (typeof schemaOrUrlOrOptions === "string") {
      options = maybeOptions;
      const elicitationId = `elicit-${generateUUID()}`;

      sdkParams = {
        mode: "url",
        message,
        url: schemaOrUrlOrOptions,
        elicitationId,
      } as ElicitRequestURLParams;
    } else if (
      schemaOrUrlOrOptions &&
      typeof schemaOrUrlOrOptions === "object" &&
      "_def" in schemaOrUrlOrOptions
    ) {
      options = maybeOptions;
      zodSchema = schemaOrUrlOrOptions as z.ZodObject<any>;
      const jsonSchema = toJsonSchemaCompat(schemaOrUrlOrOptions as any);

      sdkParams = {
        mode: "form",
        message,
        requestedSchema: jsonSchema,
      } as ElicitRequestFormParams;
    } else {
      throw new Error(
        "Invalid elicit signature: second parameter must be a Zod schema or URL string"
      );
    }
  } else {
    options = schemaOrUrlOrOptions as ElicitOptions | undefined;
    const params = messageOrParams;

    if (params.mode === "url") {
      const elicitationId = `elicit-${generateUUID()}`;

      sdkParams = {
        mode: "url",
        message: params.message,
        url: params.url,
        elicitationId,
      } as ElicitRequestURLParams;
    } else {
      sdkParams = {
        mode: "form",
        message: params.message,
        requestedSchema: params.requestedSchema,
      } as ElicitRequestFormParams;
    }
  }

  return { sdkParams, zodSchema, options };
}

/**
 * Create the sample() method for enhanced context
 */
export function createSampleMethod(
  createMessage: (
    params: CreateMessageRequest["params"],
    options?: { timeout?: number }
  ) => Promise<CreateMessageResult>,
  progressToken: number | undefined,
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, unknown>;
      }) => Promise<void>)
    | undefined
): {
  (prompt: string, options?: SampleOptions): Promise<CreateMessageResult>;
  (
    sampleParams: CreateMessageRequest["params"],
    options?: SampleOptions
  ): Promise<CreateMessageResult>;
} {
  return async (
    promptOrParams: string | CreateMessageRequest["params"],
    options?: SampleOptions
  ): Promise<CreateMessageResult> => {
    // Convert string prompt to proper message format
    let sampleParams: CreateMessageRequest["params"];
    if (typeof promptOrParams === "string") {
      sampleParams = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: promptOrParams,
            },
          },
        ],
        maxTokens: options?.maxTokens || 1000,
        ...(options?.modelPreferences && {
          modelPreferences: options.modelPreferences,
        }),
        ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
        ...(options?.temperature !== undefined && {
          temperature: options.temperature,
        }),
        ...(options?.stopSequences && { stopSequences: options.stopSequences }),
        ...(options?.metadata && { metadata: options.metadata }),
      };
    } else {
      sampleParams = promptOrParams;
    }

    const { timeout, progressIntervalMs = 5000, onProgress } = options ?? {};

    let progressCount = 0;
    let completed = false;
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    if (progressToken !== undefined && sendNotification) {
      progressInterval = setInterval(async () => {
        if (completed) return;

        progressCount++;
        const progressData = {
          progress: progressCount,
          total: undefined as number | undefined,
          message: `Waiting for LLM response... (${progressCount * Math.round(progressIntervalMs / 1000)}s elapsed)`,
        };

        if (onProgress) {
          try {
            onProgress(progressData);
          } catch {
            // Ignore errors
          }
        }

        await sendProgressNotification(
          sendNotification,
          progressToken,
          progressData.progress,
          progressData.total,
          progressData.message
        );
      }, progressIntervalMs);
    }

    try {
      console.log("[SAMPLING DEBUG] Calling createMessage...");
      const sdkTimeout = timeout && timeout !== Infinity ? timeout : 2147483647;
      const samplePromise = createMessage(sampleParams, {
        timeout: sdkTimeout,
      });

      console.log("[SAMPLING DEBUG] Waiting for response...");
      const result = await withTimeout(
        samplePromise,
        timeout,
        `Sampling timed out after ${timeout}ms`
      );
      console.log("[SAMPLING DEBUG] Got result:", result);

      // Track sample context event
      Telemetry.getInstance()
        .trackServerContext({
          contextType: "sample",
        })
        .catch((e) => console.debug(`Failed to track sample context: ${e}`));

      return result;
    } catch (error) {
      console.error("[SAMPLING DEBUG] Error during sampling:", error);
      throw error;
    } finally {
      completed = true;
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    }
  };
}

/**
 * Create the elicit() method for enhanced context
 */
export function createElicitMethod(
  elicitInput: (
    params: ElicitRequest["params"],
    options?: { timeout?: number }
  ) => Promise<ElicitResult>
): (
  messageOrParams: string | ElicitFormParams | ElicitUrlParams,
  schemaOrUrlOrOptions?: z.ZodObject<any> | string | ElicitOptions,
  maybeOptions?: ElicitOptions
) => Promise<ElicitResult> {
  return async (
    messageOrParams: string | ElicitFormParams | ElicitUrlParams,
    schemaOrUrlOrOptions?: z.ZodObject<any> | string | ElicitOptions,
    maybeOptions?: ElicitOptions
  ): Promise<ElicitResult> => {
    const { sdkParams, zodSchema, options } = parseElicitParams(
      messageOrParams,
      schemaOrUrlOrOptions,
      maybeOptions
    );

    const { timeout } = options ?? {};
    const sdkTimeout = timeout && timeout !== Infinity ? timeout : 2147483647;

    const result = await elicitInput(sdkParams, { timeout: sdkTimeout });

    // Track elicit context event
    Telemetry.getInstance()
      .trackServerContext({
        contextType: "elicit",
      })
      .catch((e) => console.debug(`Failed to track elicit context: ${e}`));

    // The MCP SDK returns form data in `result.content` (per spec), not `result.data`.
    // Fall back to `result.data` for backward compatibility with custom handlers.
    const inputData = result.data ?? result.content;

    if (zodSchema && result.action === "accept" && inputData) {
      try {
        const validatedData = zodSchema.parse(inputData);
        return {
          ...result,
          data: validatedData,
        };
      } catch (error: unknown) {
        const err = error as Error;
        throw new ElicitationValidationError(
          `Elicitation data validation failed: ${err.message}`,
          err
        );
      }
    }

    if (!zodSchema && result.action === "accept" && inputData) {
      return {
        ...result,
        data: inputData,
      };
    }

    return result;
  };
}

/**
 * Create the reportProgress() method for enhanced context
 */
export function createReportProgressMethod(
  progressToken: number | undefined,
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
      }) => Promise<void>)
    | undefined
):
  | ((progress: number, total?: number, message?: string) => Promise<void>)
  | undefined {
  if (progressToken !== undefined && sendNotification) {
    return async (progress: number, total?: number, message?: string) => {
      await sendProgressNotification(
        sendNotification,
        progressToken,
        progress,
        total,
        message
      );
    };
  }
  return undefined;
}

/**
 * RFC 5424 log levels with numeric values for comparison
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

/**
 * Valid log levels according to RFC 5424
 */
export const VALID_LOG_LEVELS: readonly LogLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const;

/**
 * Check if a log level is valid
 */
export function isValidLogLevel(level: string): level is LogLevel {
  return VALID_LOG_LEVELS.includes(level as LogLevel);
}

/**
 * Check if a message level meets the minimum log level threshold
 */
export function shouldLogMessage(
  messageLevel: string,
  minLevel: string | undefined
): boolean {
  // If no minimum level is set, log everything
  if (!minLevel) {
    return true;
  }

  // If either level is invalid, default to logging
  if (!isValidLogLevel(messageLevel) || !isValidLogLevel(minLevel)) {
    return true;
  }

  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[minLevel];
}

/**
 * Create log method for sending log notifications to the client
 */
function createLogMethod(
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
      }) => Promise<void>)
    | undefined,
  minLogLevel?: string
):
  | ((level: string, message: string, logger?: string) => Promise<void>)
  | undefined {
  if (!sendNotification) {
    return undefined;
  }

  return async (level: string, message: string, logger?: string) => {
    // Filter messages based on minimum log level
    if (!shouldLogMessage(level, minLogLevel)) {
      return; // Don't send messages below the minimum level
    }

    await sendNotification({
      method: "notifications/message",
      params: {
        level,
        data: message,
        logger: logger || "tool",
      },
    });

    // Track notification context event
    Telemetry.getInstance()
      .trackServerContext({
        contextType: "notification",
        notificationType: "message",
      })
      .catch((e) =>
        console.debug(`Failed to track notification context: ${e}`)
      );
  };
}

const MCP_UI_EXTENSION_ID = "io.modelcontextprotocol/ui";
const MCP_UI_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Checks whether a raw client capabilities object advertises support for
 * MCP Apps (SEP-1865 / `io.modelcontextprotocol/ui` extension).
 *
 * Useful at server setup time when you want to conditionally register
 * widget-enabled tool variants before any callback is invoked.
 *
 * @example
 * ```typescript
 * server.onClientConnected((caps) => {
 *   if (supportsApps(caps)) {
 *     // register widget tools
 *   }
 * });
 * ```
 */
export function supportsApps(
  clientCapabilities: Record<string, any> | undefined
): boolean {
  return (
    (clientCapabilities as any)?.extensions?.[
      MCP_UI_EXTENSION_ID
    ]?.mimeTypes?.includes(MCP_UI_MIME_TYPE) ?? false
  );
}

/**
 * Create client capability checker object
 */
export function createClientCapabilityChecker(
  clientCapabilities: Record<string, any> | undefined,
  clientInfo?: Record<string, any>,
  requestMeta?: Record<string, unknown>
) {
  const caps = clientCapabilities || {};

  return {
    can(capability: string): boolean {
      return capability in caps;
    },

    capabilities(): Record<string, any> {
      return { ...caps }; // Return a copy to prevent mutation
    },

    /**
     * Returns the name and version of the connecting client as advertised
     * in the MCP initialize handshake.
     */
    info(): { name?: string; version?: string } {
      return { ...(clientInfo as { name?: string; version?: string }) };
    },

    /**
     * Returns the settings object for a specific extension (SEP-1724).
     * Returns `undefined` if the client did not advertise that extension.
     *
     * @example
     * ```typescript
     * // Check for MCP Apps support (SEP-1865)
     * const uiExt = ctx.client.extension("io.modelcontextprotocol/ui");
     * if (uiExt?.mimeTypes?.includes("text/html;profile=mcp-app")) { ... }
     *
     * // Or use the convenience method:
     * if (ctx.client.supportsApps()) { ... }
     * ```
     */
    extension(id: string): Record<string, any> | undefined {
      return (caps as any)?.extensions?.[id];
    },

    /**
     * Returns `true` if the client advertises support for MCP Apps
     * (SEP-1865, extension identifier `io.modelcontextprotocol/ui`).
     *
     * Use this to conditionally register widget-enabled tool variants
     * or return widget-aware responses.
     *
     * @example
     * ```typescript
     * if (ctx.client.supportsApps()) {
     *   return widget({ uri: "ui://my-widget", props: result });
     * }
     * return text(result.summary);
     * ```
     */
    supportsApps(): boolean {
      return supportsApps(caps);
    },

    /**
     * Returns normalized end-user context from `params._meta` sent by the
     * client on this specific tool invocation.
     *
     * **Scope:** Per-invocation — unlike other `ctx.client` methods which
     * are stable for the lifetime of the MCP session, `user()` can return
     * a different value on every tool call.
     *
     * **Returns `undefined`** when the client does not include user metadata
     * (e.g. Inspector, Claude Desktop, CLI, most non-ChatGPT clients).
     *
     * **Advisory only:** This data is self-reported by the client and
     * unverified. For verified identity use `ctx.auth` (requires OAuth).
     *
     * **ChatGPT multi-tenant model:**
     * ChatGPT uses a single MCP session for all users of your app. Use
     * `subject` to identify the human and `conversationId` to identify the
     * chat thread — both vary per invocation within the same MCP session:
     *
     * ```
     * 1 MCP session  (ctx.session.sessionId)        — shared across all users
     *   N subjects   (ctx.client.user()?.subject)   — one per ChatGPT user
     *     M threads  (ctx.client.user()?.conversationId) — one per chat
     * ```
     *
     * @example
     * ```typescript
     * server.tool({ name: "greet", schema: z.object({}) }, async (_p, ctx) => {
     *   const caller = ctx.client.user();
     *   if (caller) {
     *     // Personalise by locale or location
     *     const greeting = caller.locale?.startsWith("it") ? "Ciao" : "Hello";
     *     const city = caller.location?.city ?? "there";
     *     return text(`${greeting} from ${city}!`);
     *   }
     *   return text("Hello!");
     * });
     * ```
     */
    user(): UserContext | undefined {
      return normalizeUserContext(requestMeta);
    },
  };
}

/**
 * Create sendNotification method for current session
 */
function createSendNotificationMethod(
  sessionId: string | undefined,
  sessions: Map<string, SessionData> | undefined
):
  | ((method: string, params?: Record<string, unknown>) => Promise<void>)
  | undefined {
  if (!sessionId || !sessions) {
    return undefined;
  }

  return async (method: string, params?: Record<string, unknown>) => {
    const session = sessions.get(sessionId);
    if (!session?.sendNotification) {
      console.warn(
        `[MCP] Cannot send notification to session ${sessionId} - no sendNotification function`
      );
      return;
    }

    try {
      await session.sendNotification({
        method,
        params: params || {},
      });
    } catch (error) {
      console.error(
        `[MCP] Error sending notification to session ${sessionId}:`,
        error
      );
    }
  };
}

/**
 * Create sendNotificationToSession method for any session
 */
function createSendNotificationToSessionMethod(
  sessions: Map<string, SessionData> | undefined
):
  | ((
      sessionId: string,
      method: string,
      params?: Record<string, unknown>
    ) => Promise<boolean>)
  | undefined {
  if (!sessions) {
    return undefined;
  }

  return async (
    sessionId: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<boolean> => {
    const session = sessions.get(sessionId);
    if (!session?.sendNotification) {
      return false;
    }

    try {
      await session.sendNotification({
        method,
        params: params || {},
      });
      return true;
    } catch (error) {
      console.error(
        `[MCP] Error sending notification to session ${sessionId}:`,
        error
      );
      return false;
    }
  };
}

/**
 * Create enhanced context with sample, elicit, reportProgress, log, client, session, and notification methods
 */
export function createEnhancedContext(
  baseContext: Context | undefined,
  createMessage: (
    params: CreateMessageRequest["params"],
    options?: { timeout?: number }
  ) => Promise<CreateMessageResult>,
  elicitInput: (
    params: ElicitRequest["params"],
    options?: { timeout?: number }
  ) => Promise<ElicitResult>,
  progressToken: number | undefined,
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, unknown>;
      }) => Promise<void>)
    | undefined,
  minLogLevel?: string,
  clientCapabilities?: Record<string, unknown>,
  sessionId?: string,
  sessions?: Map<string, SessionData>,
  clientInfo?: Record<string, unknown>,
  requestMeta?: Record<string, unknown>
): Context & {
  sample: ReturnType<typeof createSampleMethod>;
  elicit: ReturnType<typeof createElicitMethod>;
  reportProgress: (params: {
    progress: number;
    total?: number;
  }) => Promise<void>;
  log: (level: string, data: unknown, logger?: string) => Promise<void>;
  client: ReturnType<typeof createClientCapabilityChecker>;
  session: { id?: string };
  sendNotification: typeof sendNotification;
} {
  const enhancedContext = baseContext ? Object.create(baseContext) : {};

  enhancedContext.sample = createSampleMethod(
    createMessage,
    progressToken,
    sendNotification
  );

  enhancedContext.elicit = createElicitMethod(elicitInput);

  enhancedContext.reportProgress = createReportProgressMethod(
    progressToken,
    sendNotification
  );

  enhancedContext.log = createLogMethod(sendNotification, minLogLevel);

  // Pass requestMeta into the checker so ctx.client.user() is per-invocation
  enhancedContext.client = createClientCapabilityChecker(
    clientCapabilities,
    clientInfo,
    requestMeta
  );

  // Add session information
  if (sessionId) {
    enhancedContext.session = {
      sessionId,
    };
  }

  // Add notification methods
  const sendNotificationMethod = createSendNotificationMethod(
    sessionId,
    sessions
  );
  if (sendNotificationMethod) {
    enhancedContext.sendNotification = sendNotificationMethod;
  }

  const sendNotificationToSessionMethod =
    createSendNotificationToSessionMethod(sessions);
  if (sendNotificationToSessionMethod) {
    enhancedContext.sendNotificationToSession = sendNotificationToSessionMethod;
  }

  return enhancedContext;
}

/**
 * Build the base handler context shared by prompt and resource wrappedHandlers.
 *
 * Resolves the correct session by keying directly off the closure `sessionId`
 * (which is always authoritative for a given connection), then builds an
 * enhanced context object with `ctx.client` already populated.
 *
 * Tools use `createEnhancedContext` instead because they need the richer
 * context (sample, elicit, reportProgress, etc.), but they call the same
 * session-resolution logic via the closure `sessionId`.
 */
export function buildHandlerContext(
  sessionId: string | undefined,
  sessions: Map<string, SessionData>
): { session: SessionData | undefined; enhancedCtx: any } {
  const session = sessionId ? sessions.get(sessionId) : undefined;
  const requestContext = getRequestContext() || session?.context;
  const enhancedCtx: any = requestContext ? Object.create(requestContext) : {};
  Object.defineProperty(enhancedCtx, "client", {
    value: createClientCapabilityChecker(
      session?.clientCapabilities,
      session?.clientInfo
    ),
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return { session, enhancedCtx };
}
