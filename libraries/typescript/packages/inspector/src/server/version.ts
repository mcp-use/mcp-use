import packageJson from "../../package.json";

export const VERSION = packageJson.version;

/**
 * Get the inspector package version.
 * The version follows package.json so canary version bumps stay accurate.
 */
export function getInspectorVersion(): string {
  return VERSION;
}

declare const __MCP_USE_BUNDLED_SDK_VERSION__: string | undefined;

/**
 * The MCP SDK client version compiled into this Inspector build (a build
 * `define`), or `null` when the build did not record it (e.g. `tsx` runs).
 */
export function getBundledSdkVersion(): string | null {
  return typeof __MCP_USE_BUNDLED_SDK_VERSION__ === "string"
    ? __MCP_USE_BUNDLED_SDK_VERSION__
    : null;
}
