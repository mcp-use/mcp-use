/**
 * Hook for building MCP Apps host context (SEP-1865)
 */

import { useMemo } from "react";
import type { McpUiHostContext } from "@mcp-use/client/react";
import type { Tool } from "@mcp-use/client/react";
import type { PlaygroundSettings } from "../context/WidgetDebugContext";
import { getPackageVersion } from "../telemetry/utils";

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

const THEME_COLOR_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--muted",
  "--muted-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--ring",
] as const;

function readThemeValues(
  theme: "light" | "dark"
): Record<(typeof THEME_COLOR_VARIABLES)[number], string> {
  const probe = document.createElement("div");
  probe.className = `mcp-apps-host-theme-probe-${theme}`;
  probe.hidden = true;
  (document.body ?? document.documentElement).appendChild(probe);
  const styles = getComputedStyle(probe);
  const values = Object.fromEntries(
    THEME_COLOR_VARIABLES.map((name) => [name, readCssVar(styles, name)])
  ) as Record<(typeof THEME_COLOR_VARIABLES)[number], string>;
  probe.remove();
  return values;
}

export function buildLightDarkValue(
  lightValue: string,
  darkValue: string
): string {
  if (!lightValue) return darkValue;
  if (!darkValue) return lightValue;
  return `light-dark(${lightValue}, ${darkValue})`;
}

function buildHostStyleVariables(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const styles = getComputedStyle(document.documentElement);
  const lightValues = readThemeValues("light");
  const darkValues = readThemeValues("dark");
  const variables: Record<string, string> = {};
  const add = (name: string, value: string) => {
    if (value) variables[name] = value;
  };
  const addThemeColor = (
    name: string,
    cssVariable: string,
    fallbackCssVariable?: string
  ) => {
    const light =
      lightValues[cssVariable as keyof typeof lightValues] ||
      (fallbackCssVariable
        ? lightValues[fallbackCssVariable as keyof typeof lightValues]
        : "");
    const dark =
      darkValues[cssVariable as keyof typeof darkValues] ||
      (fallbackCssVariable
        ? darkValues[fallbackCssVariable as keyof typeof darkValues]
        : "");
    add(name, buildLightDarkValue(light, dark));
  };

  const radius = readCssVar(styles, "--radius");

  addThemeColor("--color-background-primary", "--background");
  addThemeColor("--color-background-secondary", "--card", "--secondary");
  addThemeColor("--color-background-tertiary", "--muted", "--accent");
  addThemeColor("--color-background-inverse", "--primary");
  addThemeColor("--color-background-ghost", "--accent", "--muted");
  addThemeColor("--color-background-danger", "--destructive");

  addThemeColor("--color-text-primary", "--foreground");
  addThemeColor("--color-text-secondary", "--muted-foreground");
  addThemeColor("--color-text-tertiary", "--muted-foreground");
  addThemeColor("--color-text-inverse", "--primary-foreground");
  addThemeColor("--color-text-ghost", "--accent-foreground");
  addThemeColor("--color-text-danger", "--destructive");

  addThemeColor("--color-border-primary", "--border");
  addThemeColor("--color-border-secondary", "--border");
  addThemeColor("--color-border-tertiary", "--border");
  addThemeColor("--color-ring-primary", "--ring", "--border");

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
      userAgent: `mcp-use-inspector/${getPackageVersion()}`,
      deviceCapabilities: playground.capabilities,
      safeAreaInsets: playground.safeAreaInsets,
      styles: {
        variables: buildHostStyleVariables() as any,
        css: {
          fonts:
            '@font-face{font-family:"MCP Host Sans";src:local("Ubuntu"),local("Arial");font-display:swap;}',
        },
      },
      toolInfo: tool
        ? {
            id: toolCallId,
            // ponytail: v2 Tool.inputSchema.properties values are JSONValue
            // (nullable) while @modelcontextprotocol/ext-apps still types them
            // as `object`. The runtime shape (JSON Schema) is identical, so
            // cast across the two SDK type worlds at this boundary.
            tool: tool as NonNullable<McpUiHostContext["toolInfo"]>["tool"],
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
