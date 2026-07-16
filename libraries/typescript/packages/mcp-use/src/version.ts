declare const __MCP_USE_PACKAGE_VERSION__: string;

export const VERSION = __MCP_USE_PACKAGE_VERSION__;

export function getPackageVersion(): string {
  return VERSION;
}
