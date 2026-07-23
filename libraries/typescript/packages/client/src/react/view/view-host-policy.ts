import type {
  McpUiHostCapabilities,
  McpUiSupportedContentBlockModalities,
} from "./ext-apps-bridge.js";
import type { ViewConnection, ViewDisplayMode } from "./types.js";

type CapabilityInputs = {
  hasConnection: boolean;
  hasMessageHandler: boolean;
  hasModelContextHandler: boolean;
  hasLogHandler: boolean;
  messageCapabilities?: McpUiSupportedContentBlockModalities;
  modelContextCapabilities?: McpUiSupportedContentBlockModalities;
};

export function buildDefaultHostCapabilities({
  hasConnection,
  hasMessageHandler,
  hasModelContextHandler,
  hasLogHandler,
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
    ...(hasModelContextHandler
      ? { updateModelContext: modelContextCapabilities ?? { text: {} } }
      : {}),
    ...(hasMessageHandler
      ? { message: messageCapabilities ?? { text: {} } }
      : {}),
  };
}

export function isToolVisibleToModel(tool: { _meta?: unknown }): boolean {
  if (!tool._meta || typeof tool._meta !== "object") return true;
  const ui = (tool._meta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== "object") return true;
  const visibility = (ui as Record<string, unknown>).visibility;
  return (
    !Array.isArray(visibility) || visibility.some((value) => value === "model")
  );
}

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
