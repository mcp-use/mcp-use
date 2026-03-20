import type {
  CallToolResult,
  GetPromptResult,
  PromptMessage,
} from "@modelcontextprotocol/sdk/types.js";

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
  let contentArray: any[] = [];
  if ((result as any).content) {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      // Standard case: content is already an array
      contentArray = content;
    } else if (typeof content === "object" && content.type) {
      // Edge case: content is a single object with type (wrap in array)
      contentArray = [content];
    }
  } else if (typeof result === "object" && (result as any).type) {
    // Edge case: result itself is a bare content item (no content property)
    contentArray = [result];
  }

  // Process content array
  for (const content of contentArray) {
    // Each content item becomes a user message
    // According to MCP spec, prompt messages can have text, image, audio, or resource content
    if (content.type === "text") {
      const textContent = content as { type: "text"; text: string };
      messages.push({
        role: "user",
        content: {
          type: "text",
          text: textContent.text,
        },
      });
    } else if (content.type === "image") {
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
    } else if (content.type === "resource") {
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

      const resourceData = resourceContent.resource;
      const embeddedResource: any = {
        type: "resource",
        resource: {
          uri: resourceData.uri,
          mimeType: resourceData.mimeType,
        },
      };

      if (resourceData.text) {
        embeddedResource.resource.text = resourceData.text;
      } else if (resourceData.blob) {
        embeddedResource.resource.blob = resourceData.blob;
      }

      messages.push({
        role: "user",
        content: embeddedResource,
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
