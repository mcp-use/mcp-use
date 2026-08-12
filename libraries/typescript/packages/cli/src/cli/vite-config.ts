/**
 * Resolve the project-level Vite config used only by the views client build.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.cjs",
] as const;

/**
 * Locate a project Vite config, or disable config loading when absent.
 *
 * @param cwd - Absolute project root.
 * @returns Absolute config path or `false`.
 *
 * @internal
 */
export function resolveUserViteConfig(cwd: string): string | false {
  for (const name of VITE_CONFIG_CANDIDATES) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return false;
}

/**
 * Resolve the framework-owned Tailwind stylesheet for project CSS imports.
 *
 * @returns Absolute path exported by the installed `tailwindcss` dependency.
 *
 * @internal
 */
export function resolveTailwindCss(): string {
  return fileURLToPath(import.meta.resolve("tailwindcss/index.css"));
}
