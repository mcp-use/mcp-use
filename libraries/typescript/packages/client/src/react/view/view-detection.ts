import { RESOURCE_MIME_TYPE } from "./ext-apps-bridge.js";

/**
 * Reads the MCP App resource URI from tool metadata.
 *
 * @param toolMeta - Tool `_meta` object.
 * @returns The declared view resource URI, or `null` when none is declared.
 */
export function getViewResourceUri(
  toolMeta?: Record<string, unknown>
): string | null {
  const uri = toolMeta?.ui;
  if (
    uri &&
    typeof uri === "object" &&
    "resourceUri" in uri &&
    typeof (uri as { resourceUri?: unknown }).resourceUri === "string"
  ) {
    return (uri as { resourceUri: string }).resourceUri;
  }
  return null;
}

/**
 * Tests whether tool metadata declares an MCP App resource.
 *
 * @param toolMeta - Tool `_meta` object.
 * @returns `true` when the tool declares a view resource URI.
 */
export function isViewTool(toolMeta?: Record<string, unknown>): boolean {
  return getViewResourceUri(toolMeta) !== null;
}

/**
 * Tests whether a resource uses the MCP App HTML media type.
 *
 * @param mimeType - Resource MIME type.
 * @returns `true` for the MCP App resource media type.
 */
export function isViewResource(mimeType?: string): boolean {
  return mimeType === RESOURCE_MIME_TYPE;
}
