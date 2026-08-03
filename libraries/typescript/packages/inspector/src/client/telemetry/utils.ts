declare global {
  interface Window {
    __INSPECTOR_VERSION__?: string;
  }
}

declare const __MCP_USE_PACKAGE_VERSION__: string | undefined;

export function getPackageVersion(): string {
  try {
    if (typeof window !== "undefined") {
      const injected = window.__INSPECTOR_VERSION__;
      if (injected !== undefined && injected !== "") {
        return injected;
      }
    }
    if (
      typeof __MCP_USE_PACKAGE_VERSION__ === "string" &&
      __MCP_USE_PACKAGE_VERSION__
    ) {
      return __MCP_USE_PACKAGE_VERSION__;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
