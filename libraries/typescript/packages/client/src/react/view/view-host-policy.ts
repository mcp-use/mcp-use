import type { McpUiHostCapabilities } from "./ext-apps-bridge.js";
import type { ViewConnection, ViewDisplayMode } from "./types.js";

type CapabilityInputs = {
  hasConnection: boolean;
  hasMessageHandler: boolean;
  hasModelContextHandler: boolean;
  hasLogHandler: boolean;
};

export function buildDefaultHostCapabilities({
  hasConnection,
  hasMessageHandler,
  hasModelContextHandler,
  hasLogHandler,
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
    ...(hasModelContextHandler ? { updateModelContext: { text: {} } } : {}),
    ...(hasMessageHandler ? { message: { text: {} } } : {}),
  };
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
