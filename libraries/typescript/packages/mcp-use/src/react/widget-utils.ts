/**
 * Shared utilities for widget hooks
 */

import type { CallToolResponse } from "./widget-types.js";

type RawCallToolResponse = Partial<CallToolResponse> & {
  content?: CallToolResponse["content"];
};

const isRawCallToolResponse = (value: unknown): value is RawCallToolResponse =>
  !!value && typeof value === "object";

/**
 * Normalize callTool response from different providers into a consistent format.
 * Preserves structured content and extracts text for convenience.
 */
export function normalizeCallToolResponse(raw: unknown): CallToolResponse {
  // If already normalized (has result field), return as-is
  if (isRawCallToolResponse(raw) && "result" in raw) {
    return raw as CallToolResponse;
  }

  const response = isRawCallToolResponse(raw) ? raw : {};

  // Extract content array (required)
  const content = response.content || [];

  // Extract structured content (optional, defaults to {})
  const structuredContent = response.structuredContent || {};

  // Join text content blocks into result string
  const result = content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");

  // Extract error flag and metadata
  const isError = response.isError ?? false;
  const _meta = response._meta;

  return {
    content,
    structuredContent,
    isError,
    result,
    _meta,
  };
}
