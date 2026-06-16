import packageJson from "../../package.json";

export const VERSION = packageJson.version;

/**
 * Get the inspector package version.
 * The version follows package.json so canary version bumps stay accurate.
 */
export function getInspectorVersion(): string {
  return VERSION;
}
