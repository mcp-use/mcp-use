import fs from "node:fs/promises";
import path from "node:path";
import { EvalConfigSchema, type EvalConfig } from "./config.js";
import { EvalConfigError } from "../shared/errors.js";

/** Cache for loaded eval config to avoid re-reading and parsing */
let cachedConfig: { path: string; config: EvalConfig } | null = null;

/**
 * Load and validate the eval configuration file.
 *
 * Reads eval.config.json, parses it, validates against schema, and caches the result.
 * The cache is keyed by resolved absolute path.
 *
 * @param configPath - Path to eval config file (defaults to "./eval.config.json")
 * @returns Validated eval configuration
 * @throws {EvalConfigError} If file not found, invalid JSON, or fails schema validation
 *
 * @example
 * ```typescript
 * const config = await loadEvalConfig();
 * console.log(config.default.runAgent); // "sonnet"
 * ```
 */
export async function loadEvalConfig(
  configPath = "./eval.config.json"
): Promise<EvalConfig> {
  const resolvedPath = path.resolve(configPath);
  if (cachedConfig?.path === resolvedPath) {
    return cachedConfig.config;
  }

  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, "utf-8");
  } catch (error) {
    throw new EvalConfigError(
      `Eval config not found or unreadable: ${resolvedPath}`,
      error
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new EvalConfigError(
      `Eval config is not valid JSON: ${resolvedPath}`,
      error
    );
  }

  const result = EvalConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new EvalConfigError(
      `Eval config failed validation: ${result.error.message}`
    );
  }

  cachedConfig = { path: resolvedPath, config: result.data };
  return result.data;
}

/**
 * Clear the cached eval config.
 * Useful for testing or when config file is known to have changed.
 */
export function clearEvalConfigCache(): void {
  cachedConfig = null;
}
