import { getInspectorBase } from "./basePath";

export function providerAssetUrl(filename: string): string {
  const mode =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __MCP_INSPECTOR_MODE__?: string })
          .__MCP_INSPECTOR_MODE__;
  if (mode === "development") {
    return `${getInspectorBase()}/providers/${filename}`;
  }
  if (typeof window !== "undefined" && mode !== "cloud") {
    return `${getInspectorBase()}/assets/providers/${filename}`;
  }
  return `https://inspector-cdn.mcp-use.com/providers/${filename}`;
}
