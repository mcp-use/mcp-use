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

// Re-export SessionData for backwards compatibility
export type { SessionData };

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
  let requestContext = initialRequestContext;
  let session: SessionData | undefined;
  let progressToken = extraProgressToken;
  let sendNotification = extraSendNotification;

  // First pass: find requestContext if not provided
  if (!requestContext) {
    for (const [, s] of sessions.entries()) {
      if (s.context) {
        requestContext = s.context;
        break;
      }
    }
  }

  // Second pass: find session matching context or use first session
  if (!progressToken || !sendNotification) {
    if (requestContext) {
      for (const [, s] of sessions.entries()) {
        if (s.context === requestContext) {
          session = s;
          break;
        }
      }
    } else {
      const firstSession = sessions.values().next().value;
      if (firstSession) {
        session = firstSession;
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
    options?: any
  ) => Promise<CreateMessageResult>,
  progressToken: number | undefined,
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
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
      const sdkTimeout = timeout && timeout !== Infinity ? timeout : 2147483647;
      const samplePromise = createMessage(sampleParams, {
        timeout: sdkTimeout,
      });

      return await withTimeout(
        samplePromise,
        timeout,
        `Sampling timed out after ${timeout}ms`
      );
    } catch (error) {
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
  elicitInput: (params: any, options?: any) => Promise<ElicitResult>
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

    if (zodSchema && result.action === "accept" && result.data) {
      try {
        const validatedData = zodSchema.parse(result.data);
        return {
          ...result,
          data: validatedData,
        };
      } catch (error: any) {
        throw new ElicitationValidationError(
          `Elicitation data validation failed: ${error.message}`,
          error
        );
      }
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
  };
}

/**
 * Create enhanced context with sample, elicit, reportProgress, and log methods
 */
export function createEnhancedContext(
  baseContext: Context | undefined,
  createMessage: (
    params: CreateMessageRequest["params"],
    options?: any
  ) => Promise<CreateMessageResult>,
  elicitInput: (params: any, options?: any) => Promise<ElicitResult>,
  progressToken: number | undefined,
  sendNotification:
    | ((notification: {
        method: string;
        params: Record<string, any>;
      }) => Promise<void>)
    | undefined,
  minLogLevel?: string
): any {
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

  return enhancedContext;
}
