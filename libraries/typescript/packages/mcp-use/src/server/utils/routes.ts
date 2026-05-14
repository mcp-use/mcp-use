import type { RouteConfig } from "../types/common.js";

export interface ResolvedRouteConfig {
  mcpBasePath: string;
  sseBasePath: string;
  widgetsBasePath: string;
  publicBasePath: string;
  inspectorBasePath: string;
  oauthBasePath: string;
}

const DEFAULT_ROUTES: ResolvedRouteConfig = {
  mcpBasePath: "/mcp",
  sseBasePath: "/sse",
  widgetsBasePath: "/mcp-use/widgets",
  publicBasePath: "/mcp-use/public",
  inspectorBasePath: "/inspector",
  oauthBasePath: "",
};

function normalizePath(input: string, allowEmpty: boolean): string {
  const trimmed = input.trim();
  if (allowEmpty && (trimmed === "" || trimmed === "/")) return "";
  if (!trimmed) throw new Error("Route path cannot be empty");

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

export function resolveRouteConfig(config?: RouteConfig): ResolvedRouteConfig {
  if (!config) return { ...DEFAULT_ROUTES };

  return {
    mcpBasePath: normalizePath(
      config.mcpBasePath ?? DEFAULT_ROUTES.mcpBasePath,
      false
    ),
    sseBasePath: normalizePath(
      config.sseBasePath ?? DEFAULT_ROUTES.sseBasePath,
      false
    ),
    widgetsBasePath: normalizePath(
      config.widgetsBasePath ?? DEFAULT_ROUTES.widgetsBasePath,
      false
    ),
    publicBasePath: normalizePath(
      config.publicBasePath ?? DEFAULT_ROUTES.publicBasePath,
      false
    ),
    inspectorBasePath: normalizePath(
      config.inspectorBasePath ?? DEFAULT_ROUTES.inspectorBasePath,
      false
    ),
    oauthBasePath: normalizePath(
      config.oauthBasePath ?? DEFAULT_ROUTES.oauthBasePath,
      true
    ),
  };
}

export function joinRoute(basePath: string, subPath: string): string {
  if (!basePath) return normalizePath(subPath, false);
  const base = normalizePath(basePath, false);
  const child = normalizePath(subPath, false);
  if (child === "/") return base;
  return `${base}${child}`;
}
