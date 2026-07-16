import { Tel } from "@mcp-use/client";
import type { BaseTelemetryEvent } from "./events.js";
import { MCPInspectorOpenEvent } from "./events.js";

type InspectorMode = "standalone" | "embedded" | "cloud";

function detectInspectorMode(): InspectorMode {
  if (typeof window === "undefined") return "standalone";
  const injected = (window as unknown as { __MCP_INSPECTOR_MODE__?: string })
    .__MCP_INSPECTOR_MODE__;
  if (
    injected === "standalone" ||
    injected === "embedded" ||
    injected === "cloud"
  ) {
    return injected;
  }
  return "standalone";
}

export async function captureInspectorEvent(
  event: BaseTelemetryEvent
): Promise<void> {
  await Tel.getInstance().capture({
    name: event.name,
    properties: {
      ...event.properties,
      package: "inspector",
      mode: detectInspectorMode(),
    },
  });
}

export async function trackInspectorOpen(data: {
  serverUrl?: string;
  connectionCount?: number;
}): Promise<void> {
  await captureInspectorEvent(new MCPInspectorOpenEvent(data));
}
