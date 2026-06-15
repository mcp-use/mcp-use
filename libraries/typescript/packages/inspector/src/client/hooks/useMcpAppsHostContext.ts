/**
 * Hook for building MCP Apps host context (SEP-1865)
 */

import { useMemo } from "react";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { PlaygroundSettings } from "../context/WidgetDebugContext";

type DisplayMode = "inline" | "pip" | "fullscreen";

interface HostContextParams {
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

function readCssVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

function buildHostStyleVariables(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const styles = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  const add = (name: string, value: string) => {
    if (value) variables[name] = value;
  };

  const background = readCssVar(styles, "--background");
  const foreground = readCssVar(styles, "--foreground");
  const card = readCssVar(styles, "--card");
  const muted = readCssVar(styles, "--muted");
  const mutedForeground = readCssVar(styles, "--muted-foreground");
  const primary = readCssVar(styles, "--primary");
  const primaryForeground = readCssVar(styles, "--primary-foreground");
  const secondary = readCssVar(styles, "--secondary");
  const accent = readCssVar(styles, "--accent");
  const accentForeground = readCssVar(styles, "--accent-foreground");
  const destructive = readCssVar(styles, "--destructive");
  const border = readCssVar(styles, "--border");
  const ring = readCssVar(styles, "--ring");
  const radius = readCssVar(styles, "--radius");

  add("--color-background-primary", background);
  add("--color-background-secondary", card || secondary);
  add("--color-background-tertiary", muted || accent);
  add("--color-background-inverse", primary);
  add("--color-background-ghost", accent || muted);
  add("--color-background-danger", destructive);

  add("--color-text-primary", foreground);
  add("--color-text-secondary", mutedForeground);
  add("--color-text-tertiary", mutedForeground);
  add("--color-text-inverse", primaryForeground);
  add("--color-text-ghost", accentForeground || mutedForeground);
  add("--color-text-danger", destructive);

  add("--color-border-primary", border);
  add("--color-border-secondary", border);
  add("--color-border-tertiary", border);
  add("--color-ring-primary", ring || border);

  add("--border-radius-sm", radius);
  add("--border-radius-md", radius);
  add("--border-radius-lg", radius);
  add(
    "--font-sans",
    "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  );

  return variables;
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
      styles: { variables: buildHostStyleVariables() as any },
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
