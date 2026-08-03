import type {
  McpUiHostCapabilities,
  McpUiSupportedContentBlockModalities,
} from "./ext-apps-bridge.js";
import type { ViewConnection, ViewDisplayMode } from "./types.js";

/** Inputs used to derive the capabilities advertised by an MCP App host. */
type CapabilityInputs = {
  hasConnection: boolean;
  hasMessageHandler: boolean;
  hasModelContextHandler: boolean;
  hasLogHandler: boolean;
  hasSamplingHandler?: boolean;
  hasDownloadHandler?: boolean;
  messageCapabilities?: McpUiSupportedContentBlockModalities;
  modelContextCapabilities?: McpUiSupportedContentBlockModalities;
};

/**
 * Builds host capabilities from the callbacks and connections the host exposes.
 *
 * @param inputs - Available host features and supported content modalities.
 * @returns Capabilities suitable for MCP App bridge initialization.
 */
export function buildDefaultHostCapabilities({
  hasConnection,
  hasMessageHandler,
  hasModelContextHandler,
  hasLogHandler,
  hasSamplingHandler,
  hasDownloadHandler,
  messageCapabilities,
  modelContextCapabilities,
}: CapabilityInputs): McpUiHostCapabilities {
  return {
    openLinks: {},
    ...(hasConnection
      ? {
          serverTools: {},
          serverResources: {},
        }
      : {}),
    ...(hasLogHandler ? { logging: {} } : {}),
    ...(hasSamplingHandler ? { sampling: {} } : {}),
    ...(hasDownloadHandler ? { downloadFile: {} } : {}),
    ...(hasModelContextHandler
      ? { updateModelContext: modelContextCapabilities ?? { text: {} } }
      : {}),
    ...(hasMessageHandler
      ? { message: messageCapabilities ?? { text: {} } }
      : {}),
  };
}

/**
 * Tests whether a tool is visible to the model.
 *
 * Tools without explicit visibility metadata remain model-visible.
 *
 * @param tool - Tool metadata to inspect.
 * @returns `true` when the tool may be presented to the model.
 */
export function isToolVisibleToModel(tool: { _meta?: unknown }): boolean {
  if (!tool._meta || typeof tool._meta !== "object") return true;
  const ui = (tool._meta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== "object") return true;
  const visibility = (ui as Record<string, unknown>).visibility;
  return (
    !Array.isArray(visibility) || visibility.some((value) => value === "model")
  );
}

/**
 * Validates and dispatches an MCP App `ui/message` payload.
 *
 * @param handler - Host callback that accepts message content.
 * @param content - Content blocks supplied by the app.
 * @throws When the host has no message handler or `content` is empty.
 */
export async function dispatchUiMessage(
  handler: ((content: unknown[]) => void | Promise<void>) | undefined,
  content: unknown[]
): Promise<void> {
  if (!handler) {
    throw new Error("This host surface does not support ui/message");
  }
  if (content.length === 0) {
    throw new Error("ui/message requires at least one content block");
  }
  await handler(content);
}

/**
 * Resolves a display-mode request against host and app availability.
 *
 * @param options - Requested and current modes plus each side's supported modes.
 * @returns The requested mode when both sides support it; otherwise `current`.
 */
export function resolveRequestedDisplayMode({
  requested,
  current,
  hostAvailable,
  appAvailable,
}: {
  requested: ViewDisplayMode;
  current: ViewDisplayMode;
  hostAvailable?: readonly ViewDisplayMode[];
  appAvailable?: readonly ViewDisplayMode[];
}): ViewDisplayMode {
  const hostModes = hostAvailable ?? ["inline"];
  const appModes = appAvailable ?? ["inline"];
  return hostModes.includes(requested) && appModes.includes(requested)
    ? requested
    : current;
}

/**
 * Asserts that an MCP App may call a named server tool.
 *
 * @param tools - Tools available through the live view connection.
 * @param name - Tool name requested by the app.
 * @throws When the tool is unavailable or not visible to apps.
 */
export function assertAppCanCallTool(
  tools: ViewConnection["tools"],
  name: string
): void {
  const tool = tools?.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool "${name}" is not available to this app`);
  }

  const visibility = tool._meta?.ui?.visibility;
  if (visibility && !visibility.includes("app")) {
    throw new Error(`Tool "${name}" is not available to this app`);
  }
}
