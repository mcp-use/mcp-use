import type {
  CallToolResult,
  ReadResourceResult,
  ResourceContents,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";

/**
 * Check if a result is a ReadResourceResult (has 'contents' array)
 */
function isReadResourceResult(
  result: CallToolResult | ReadResourceResult
): result is ReadResourceResult {
  return "contents" in result && Array.isArray(result.contents);
}

/**
 * Extract MIME type from CallToolResult
 * Priority: _meta.mimeType > content type inference
 */
function extractMimeType(result: CallToolResult): string {
  // Check _meta for explicit MIME type
  if (result._meta && typeof result._meta === "object") {
    const meta = result._meta as Record<string, any>;
    if (meta.mimeType && typeof meta.mimeType === "string") {
      return meta.mimeType;
    }
  }

  // Infer from content type
  if (result.content && result.content.length > 0) {
    const firstContent = result.content[0];

    // Image content
    if (firstContent.type === "image") {
      return (firstContent as any).mimeType || "image/png";
    }

    // Text content - default to text/plain
    if (firstContent.type === "text") {
      return "text/plain";
    }

    // Resource content
    if (firstContent.type === "resource") {
      const resourceData = (firstContent as any).resource;
      return resourceData?.mimeType || "application/octet-stream";
    }
  }

  // Default fallback
  return "text/plain";
}

/**
 * Check if the content is binary based on metadata
 */
function isBinaryContent(result: CallToolResult): boolean {
  if (result._meta && typeof result._meta === "object") {
    const meta = result._meta as Record<string, any>;
    return meta.isBinary === true || meta.isImage === true;
  }
  return false;
}

/**
 * Convert CallToolResult to ReadResourceResult
 *
 * This function enables using tool response helpers (text(), object(), image(), etc.)
 * in resource callbacks by converting them to the proper resource format.
 *
 * @param uri - The resource URI
 * @param result - CallToolResult or ReadResourceResult to convert
 * @returns ReadResourceResult with proper resource contents
 *
 * @example
 * ```typescript
 * const toolResult = text("Hello World");
 * const resourceResult = convertToolResultToResourceResult("app://greeting", toolResult);
 * // Returns: { contents: [{ uri: "app://greeting", mimeType: "text/plain", text: "Hello World" }] }
 * ```
 */
export function convertToolResultToResourceResult(
  uri: string,
  result: CallToolResult | ReadResourceResult
): ReadResourceResult {
  // If already a ReadResourceResult, return as-is
  if (isReadResourceResult(result)) {
    return result;
  }

  // Convert CallToolResult to ReadResourceResult
  const mimeType = extractMimeType(result);
  const isBinary = isBinaryContent(result);
  const contents: ResourceContents[] = [];

  // Process content array
  if (result.content && result.content.length > 0) {
    for (const content of result.content) {
      if (content.type === "text") {
        const textContent = content as { type: "text"; text: string };

        // Binary content - encode as blob
        if (isBinary) {
          contents.push({
            uri,
            mimeType,
            blob: textContent.text,
          } as ResourceContents);
        } else {
          // Text content
          contents.push({
            uri,
            mimeType,
            text: textContent.text,
          } as ResourceContents);
        }
      } else if (content.type === "image") {
        // Image content - treat as binary blob
        const imageContent = content as {
          type: "image";
          data: string;
          mimeType?: string;
        };
        contents.push({
          uri,
          mimeType: imageContent.mimeType || mimeType,
          blob: imageContent.data,
        } as ResourceContents);
      } else if (content.type === "resource") {
        // Resource content - extract and reformat
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

        // Create complete ResourceContents object based on data type
        if (resourceData.text !== undefined) {
          contents.push({
            uri: resourceData.uri,
            mimeType: resourceData.mimeType || mimeType,
            text: resourceData.text,
          } as ResourceContents);
        } else if (resourceData.blob !== undefined) {
          contents.push({
            uri: resourceData.uri,
            mimeType: resourceData.mimeType || mimeType,
            blob: resourceData.blob,
          } as ResourceContents);
        } else {
          // Default to empty text if neither text nor blob is present
          contents.push({
            uri: resourceData.uri,
            mimeType: resourceData.mimeType || mimeType,
            text: "",
          } as ResourceContents);
        }
      }
    }
  }

  // If no contents were generated, create a default empty text content
  if (contents.length === 0) {
    contents.push({
      uri,
      mimeType: "text/plain",
      text: "",
    } as ResourceContents);
  }

  return { contents } as ReadResourceResult;
}
