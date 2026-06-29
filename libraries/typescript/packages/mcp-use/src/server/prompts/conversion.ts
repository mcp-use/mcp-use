import type {
  CallToolResult,
  GetPromptResult,
  PromptMessage,
} from "@modelcontextprotocol/server";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Check if a result is a GetPromptResult (has 'messages' array)
 */
function isGetPromptResult(
  result: CallToolResult | GetPromptResult
): result is GetPromptResult {
  return "messages" in result && Array.isArray(result.messages);
}

/**
 * Convert CallToolResult to GetPromptResult
 *
 * This function enables using tool response helpers (text(), object(), image(), etc.)
 * in prompt callbacks by converting them to the proper prompt message format.
 *
 * According to the MCP spec, prompts return messages with roles and content.
 * We convert tool-style content to user-role messages.
 *
 * @param result - CallToolResult or GetPromptResult to convert
 * @returns GetPromptResult with proper prompt messages
 *
 * @example
 * ```typescript
 * const toolResult = text("Please review this code");
 * const promptResult = convertToolResultToPromptResult(toolResult);
 * // Returns: { messages: [{ role: "user", content: { type: "text", text: "Please review this code" } }] }
 * ```
 */
export function convertToolResultToPromptResult(
  result: CallToolResult | GetPromptResult
): GetPromptResult {
  // If already a GetPromptResult, return as-is
  if (isGetPromptResult(result)) {
    return result;
  }

  // Convert CallToolResult to GetPromptResult
  const messages: PromptMessage[] = [];

  // Normalize content to an array for consistent processing
  let contentArray: unknown[] = [];
  const resultRecord = asRecord(result);
  if (resultRecord?.content) {
    const content = resultRecord.content;
    if (Array.isArray(content)) {
      // Standard case: content is already an array
      contentArray = content;
    } else if (asRecord(content)?.type) {
      // Edge case: content is a single object with type (wrap in array)
      contentArray = [content];
    }
  } else if (resultRecord?.type) {
    // Edge case: result itself is a bare content item (no content property)
    contentArray = [result];
  }

  // Process content array
  for (const content of contentArray) {
    // Each content item becomes a user message
    // According to MCP spec, prompt messages can have text, image, audio, or resource content
    const contentRecord = asRecord(content);
    if (contentRecord?.type === "text") {
      const textContent = content as { type: "text"; text: string };
      messages.push({
        role: "user",
        content: {
          type: "text",
          text: textContent.text,
        },
      });
    } else if (contentRecord?.type === "image") {
      const imageContent = content as {
        type: "image";
        data: string;
        mimeType?: string;
      };
      messages.push({
        role: "user",
        content: {
          type: "image",
          data: imageContent.data,
          mimeType: imageContent.mimeType || "image/png",
        },
      });
    } else if (contentRecord?.type === "resource") {
      // Embedded resource in prompt
      const resourceContent = content as {
        type: "resource";
        resource: {
          uri: string;
          mimeType?: string;
          text?: string;
          blob?: string;
        };
      };

      messages.push({
        role: "user",
        content:
          resourceContent.resource.blob !== undefined
            ? {
                type: "resource",
                resource: {
                  uri: resourceContent.resource.uri,
                  mimeType: resourceContent.resource.mimeType,
                  blob: resourceContent.resource.blob,
                },
              }
            : {
                type: "resource",
                resource: {
                  uri: resourceContent.resource.uri,
                  mimeType: resourceContent.resource.mimeType,
                  text: resourceContent.resource.text ?? "",
                },
              },
      });
    }
  }

  // If no messages were generated, create a default empty text message
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: {
        type: "text",
        text: "",
      },
    });
  }

  return {
    messages,
    description: result._meta?.description as string | undefined,
  };
}
