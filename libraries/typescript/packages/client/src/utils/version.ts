declare const __MCP_USE_PACKAGE_VERSION__: string;

/** Installed `@mcp-use/client` package version. */
export const VERSION = __MCP_USE_PACKAGE_VERSION__;

/**
 * Returns the installed `@mcp-use/client` package version.
 *
 * @returns Package version string.
 */
export function getPackageVersion(): string {
  return VERSION;
}
