/**
 * Hook for building MCP Apps host context (SEP-1865)
 */

import { useMemo } from "react";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { PlaygroundSettings } from "../context/WidgetDebugContext";

type DisplayMode = "inline" | "pip" | "fullscreen";

export interface HostContextParams {
  theme: "light" | "dark";
  displayMode: DisplayMode;
  maxWidth: number;
  maxHeight: number;
  playground: PlaygroundSettings;
  deviceType: string;
  toolCallId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolMetadata?: Record<string, unknown>;
  tool?: Tool; // Full Tool object from MCP SDK
}

/**
 * Build SEP-1865 compliant host context for MCP Apps
 */
export function useMcpAppsHostContext({
  theme,
  displayMode,
  maxWidth,
  maxHeight,
  playground,
  deviceType,
  toolCallId,
  toolName,
  toolInput,
  toolOutput,
  toolMetadata,
  tool,
}: HostContextParams): McpUiHostContext {
  return useMemo<McpUiHostContext>(
    () => ({
      theme,
      displayMode,
      availableDisplayModes: ["inline", "pip", "fullscreen"],
      containerDimensions: { maxHeight, maxWidth },
      locale: playground.locale,
      timeZone: playground.timeZone,
      platform: deviceType === "mobile" ? "mobile" : "web",
      userAgent: "mcp-use-inspector/0.16.2",
      deviceCapabilities: playground.capabilities,
      safeAreaInsets: playground.safeAreaInsets,
      styles: { variables: {} as any },
      toolInfo: tool
        ? {
            id: toolCallId,
            tool: tool,
          }
        : undefined,
    }),
    [
      theme,
      displayMode,
      maxHeight,
      maxWidth,
      playground.locale,
      playground.timeZone,
      playground.capabilities,
      playground.safeAreaInsets,
      deviceType,
      toolCallId,
      toolName,
      toolInput,
      toolOutput,
      toolMetadata,
      tool,
    ]
  );
}
