/**
 * Shared utilities for widget hooks
 */

import type { CallToolResponse } from "./widget-types.js";

/**
 * Normalize callTool response from different providers into a consistent format.
 * Preserves structured content and extracts text for convenience.
 */
export function normalizeCallToolResponse(raw: any): CallToolResponse {
  // If already normalized (has result field), return as-is
  if (raw && typeof raw === "object" && "result" in raw) {
    return raw as CallToolResponse;
  }

  // Extract content array (required)
  const content = raw?.content || [];

  // Extract structured content (optional, defaults to {})
  const structuredContent = raw?.structuredContent || {};

  // Join text content blocks into result string
  const result = content
    .filter((block: any) => block.type === "text" && block.text)
    .map((block: any) => block.text)
    .join("\n");

  // Extract error flag and metadata
  const isError = raw?.isError ?? false;
  const _meta = raw?._meta;

  return {
    content,
    structuredContent,
    isError,
    result,
    _meta,
  };
}
