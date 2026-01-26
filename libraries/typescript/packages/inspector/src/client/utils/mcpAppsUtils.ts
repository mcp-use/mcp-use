/**
 * MCP Apps Detection Utilities
 *
 * Utilities for detecting and working with MCP Apps (SEP-1865) widgets.
 * Handles detection priority: MCP Apps → OpenAI SDK → MCP-UI
 */

export enum UIType {
  MCP_APPS = "mcp-apps",
  OPENAI_SDK = "openai-sdk",
  MCP_UI = "mcp-ui",
}

/**
 * Detect the UI type from tool metadata and result
 *
 * Detection priority:
 * 1. MCP Apps (SEP-1865): Check for ui.resourceUri metadata (in tool definition or result._meta)
 * 2. OpenAI SDK: Check for openai/outputTemplate metadata
 * 3. MCP-UI: Check for inline ui:// resource in result
 *
 * @param toolMeta - Tool metadata from tool definition
 * @param toolResult - Tool execution result
 * @returns The detected UI type or null if no UI is found
 */
export function detectUIType(
  toolMeta: Record<string, unknown> | undefined,
  toolResult: unknown
): UIType | null {
  // 1. MCP Apps (SEP-1865): Check for ui.resourceUri metadata
  // Check both tool definition metadata and result._meta
  const defUri = getToolUiResourceUri(toolMeta);
  if (defUri) {
    console.log("[detectUIType] Found MCP Apps in tool definition:", defUri);
    return UIType.MCP_APPS;
  }

  // Also check result._meta.ui.resourceUri (some servers put it here)
  const resultMeta = (toolResult as { _meta?: Record<string, unknown> })?._meta;
  const resultUri = getToolUiResourceUri(resultMeta);
  if (resultUri) {
    console.log("[detectUIType] Found MCP Apps in result._meta:", resultUri);
    return UIType.MCP_APPS;
  }

  // 2. OpenAI SDK: Check for openai/outputTemplate metadata
  if (toolMeta?.["openai/outputTemplate"]) {
    console.log("[detectUIType] Found OpenAI SDK");
    return UIType.OPENAI_SDK;
  }

  // 3. MCP-UI: Check for inline ui:// resource in result
  const directResource = (toolResult as { resource?: { uri?: string } })
    ?.resource;
  if (directResource?.uri?.startsWith("ui://")) {
    console.log("[detectUIType] Found MCP-UI (direct resource)");
    return UIType.MCP_UI;
  }

  const content = (toolResult as { content?: unknown[] })?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isUIResource(item as any)) {
        console.log("[detectUIType] Found MCP-UI (in content)");
        return UIType.MCP_UI;
      }
    }
  }

  console.log("[detectUIType] No UI type detected");
  return null;
}

/**
 * Get the UI resource URI from tool metadata and/or result based on UI type
 *
 * @param uiType - The detected UI type
 * @param toolMeta - Tool metadata from tool definition
 * @param toolResult - Tool execution result (optional, for checking result._meta)
 * @returns The resource URI or null if not found
 */
export function getUIResourceUri(
  uiType: UIType | null,
  toolMeta: Record<string, unknown> | undefined,
  toolResult?: unknown
): string | null {
  switch (uiType) {
    case UIType.MCP_APPS: {
      // Check tool definition metadata first
      const defUri = getToolUiResourceUri(toolMeta);
      if (defUri) return defUri;

      // Then check result._meta (some servers put it here)
      const resultMeta = (toolResult as { _meta?: Record<string, unknown> })
        ?._meta;
      return getToolUiResourceUri(resultMeta);
    }

    case UIType.OPENAI_SDK:
      return (toolMeta?.["openai/outputTemplate"] as string) ?? null;
    default:
      return null;
  }
}

/**
 * Get tool's ui.resourceUri from metadata (SEP-1865)
 *
 * @param toolMeta - Tool metadata
 * @returns The resource URI or null if not found
 */
export function getToolUiResourceUri(
  toolMeta: Record<string, unknown> | undefined
): string | null {
  if (!toolMeta) return null;

  const ui = toolMeta.ui as { resourceUri?: string } | undefined;
  return ui?.resourceUri ?? null;
}

/**
 * Check if a tool result item is a UI resource
 *
 * @param item - Tool result content item
 * @returns True if the item is a UI resource
 */
function isUIResource(item: any): boolean {
  if (!item || typeof item !== "object") return false;

  return (
    item.type === "resource" &&
    typeof item.resource?.uri === "string" &&
    item.resource.uri.startsWith("ui://")
  );
}

/**
 * Check if any tool in the tools data has MCP Apps support
 *
 * @param toolsData - Tools list with metadata
 * @returns True if at least one tool has MCP Apps support
 */
export function isMCPApp(
  toolsData?: {
    tools?: any[];
    toolsMetadata?: Record<string, Record<string, unknown>>;
  } | null
): boolean {
  const metadata = toolsData?.toolsMetadata;
  if (!metadata) return false;

  return Object.values(metadata).some(
    (meta) => getToolUiResourceUri(meta) != null
  );
}

/**
 * Check if any tool in the tools data has OpenAI Apps SDK support
 *
 * @param toolsData - Tools list with metadata
 * @returns True if at least one tool has OpenAI Apps SDK support
 */
export function isOpenAIApp(
  toolsData?: {
    tools?: any[];
    toolsMetadata?: Record<string, Record<string, unknown>>;
  } | null
): boolean {
  const metadata = toolsData?.toolsMetadata;
  if (!metadata) return false;

  return Object.values(metadata).some(
    (meta) =>
      (meta as Record<string, unknown> | undefined)?.[
        "openai/outputTemplate"
      ] != null
  );
}

/**
 * Get the visibility array from tool metadata.
 * Default: ["model", "app"] if not specified (per SEP-1865)
 *
 * @param toolMeta - Tool metadata
 * @returns Array of visibility targets
 */
export function getToolVisibility(
  toolMeta: Record<string, unknown> | undefined
): Array<"model" | "app"> {
  const ui = toolMeta?.ui as
    | { visibility?: Array<"model" | "app"> }
    | undefined;
  return ui?.visibility ?? ["model", "app"];
}

/**
 * Check if tool is visible to model only (not callable by apps).
 * True when visibility is exactly ["model"]
 *
 * @param toolMeta - Tool metadata
 * @returns True if tool is model-only
 */
export function isVisibleToModelOnly(
  toolMeta: Record<string, unknown> | undefined
): boolean {
  const visibility = getToolVisibility(toolMeta);
  return visibility.length === 1 && visibility[0] === "model";
}

/**
 * Check if tool is visible to app only (hidden from model).
 * True when visibility is exactly ["app"]
 *
 * @param toolMeta - Tool metadata
 * @returns True if tool is app-only
 */
export function isVisibleToAppOnly(
  toolMeta: Record<string, unknown> | undefined
): boolean {
  const visibility = getToolVisibility(toolMeta);
  return visibility.length === 1 && visibility[0] === "app";
}
