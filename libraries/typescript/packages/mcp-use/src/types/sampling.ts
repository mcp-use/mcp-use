/**
 * Types for MCP sampling support
 * Based on MCP specification: https://modelcontextprotocol.io/specification/2025-06-18/client/sampling
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Message content types for sampling requests
 */
export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string };

/**
 * Message in a sampling request
 */
export interface SamplingMessage {
  role: "user" | "assistant" | "system";
  content: MessageContent | MessageContent[];
}

/**
 * Model hint for sampling preferences
 */
export interface ModelHint {
  name: string;
}

/**
 * Model preferences for sampling requests
 */
export interface ModelPreferences {
  hints?: ModelHint[];
  costPriority?: number; // 0-1, higher = prefer cheaper models
  speedPriority?: number; // 0-1, higher = prefer faster models
  intelligencePriority?: number; // 0-1, higher = prefer more capable models
}

/**
 * Parameters for creating a sampling message (sampling/createMessage request)
 */
export interface CreateMessageRequestParams {
  messages: SamplingMessage[];
  modelPreferences?: ModelPreferences;
  systemPrompt?: string;
  maxTokens?: number;
}

/**
 * Result from a sampling request
 */
export interface CreateMessageResult {
  role: "assistant";
  content: MessageContent;
  model: string;
  stopReason: "endTurn" | "stopSequence" | "maxTokens" | "cancelled" | "error";
}

/**
 * Error data for sampling requests
 */
export interface ErrorData {
  code: number;
  message: string;
  data?: any;
}

/**
 * Sampling callback function type
 * 
 * This callback is invoked when an MCP server requests sampling (LLM generation)
 * from the client. The callback should integrate with an LLM provider and return
 * the generated response.
 * 
 * @param context - The MCP client instance (for accessing session info)
 * @param params - The sampling request parameters
 * @returns Either a CreateMessageResult with the LLM response, or ErrorData if the request should be rejected
 */
export type SamplingCallback = (
  context: Client,
  params: CreateMessageRequestParams
) => Promise<CreateMessageResult | ErrorData>;

/**
 * Validate CreateMessageRequestParams structure
 * 
 * @param params - The parameters to validate
 * @returns ErrorData if validation fails, null if valid
 */
export function validateCreateMessageRequestParams(
  params: CreateMessageRequestParams
): ErrorData | null {
  // Validate messages array
  if (!params.messages || !Array.isArray(params.messages) || params.messages.length === 0) {
    return {
      code: -32602,
      message: "Invalid request: messages array is required and must not be empty",
    };
  }

  // Validate each message
  for (const msg of params.messages) {
    if (!msg.role || !["user", "assistant", "system"].includes(msg.role)) {
      return {
        code: -32602,
        message: `Invalid message role: ${msg.role}. Must be 'user', 'assistant', or 'system'`,
      };
    }

    if (!msg.content) {
      return {
        code: -32602,
        message: "Invalid message: content is required",
      };
    }

    // Validate content structure
    const contents = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const content of contents) {
      if (!content.type) {
        return {
          code: -32602,
          message: "Invalid content: type is required",
        };
      }

      if (content.type === "text" && typeof content.text !== "string") {
        return {
          code: -32602,
          message: "Invalid text content: text must be a string",
        };
      }

      if (content.type === "image" && (!content.data || !content.mimeType)) {
        return {
          code: -32602,
          message: "Invalid image content: data and mimeType are required",
        };
      }

      if (content.type === "audio" && (!content.data || !content.mimeType)) {
        return {
          code: -32602,
          message: "Invalid audio content: data and mimeType are required",
        };
      }
    }
  }

  // Validate model preferences if provided
  if (params.modelPreferences) {
    const prefs = params.modelPreferences;
    if (prefs.costPriority !== undefined && (prefs.costPriority < 0 || prefs.costPriority > 1)) {
      return {
        code: -32602,
        message: "Invalid costPriority: must be between 0 and 1",
      };
    }
    if (prefs.speedPriority !== undefined && (prefs.speedPriority < 0 || prefs.speedPriority > 1)) {
      return {
        code: -32602,
        message: "Invalid speedPriority: must be between 0 and 1",
      };
    }
    if (prefs.intelligencePriority !== undefined && (prefs.intelligencePriority < 0 || prefs.intelligencePriority > 1)) {
      return {
        code: -32602,
        message: "Invalid intelligencePriority: must be between 0 and 1",
      };
    }
    if (prefs.hints && !Array.isArray(prefs.hints)) {
      return {
        code: -32602,
        message: "Invalid hints: must be an array",
      };
    }
  }

  // Validate maxTokens if provided
  if (params.maxTokens !== undefined && (params.maxTokens < 1 || !Number.isInteger(params.maxTokens))) {
    return {
      code: -32602,
      message: "Invalid maxTokens: must be a positive integer",
    };
  }

  return null;
}

