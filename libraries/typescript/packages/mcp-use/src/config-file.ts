/**
 * File-system based config loading.
 * Separated from config.ts so that browser bundles never pull in require("fs").
 */
export function loadConfigFile(filepath: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs");
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}
