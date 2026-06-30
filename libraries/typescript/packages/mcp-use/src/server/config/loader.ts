/**
 * Loader for the `mcp-use.json` project config.
 *
 * Resolution walks UP from a starting directory to the filesystem root,
 * returning the nearest `mcp-use.json`. The file is read and parsed with
 * `JSON.parse` ONLY — there is no code execution (no import/eval/tsx), so a
 * config file can never run arbitrary code at load time.
 *
 * The SDK must work without a config file (gradual adoption): when no
 * `mcp-use.json` is found, a fully-defaulted config is returned with
 * `configPath: null` and `projectRoot` set to the starting directory.
 *
 * File reads are async + dynamically imported from `node:` modules to match
 * the cross-runtime conventions in `../utils/runtime.ts` (Deno compatibility).
 */

import type { z } from "zod";
import { getCwd } from "../utils/runtime.js";
import {
  CONFIG_FILE_NAME,
  configSchema,
  type ResolvedConfig,
} from "./schema.js";

/** Result of {@link loadConfig}. */
export interface LoadConfigResult {
  /** The validated, fully-defaulted config. */
  config: ResolvedConfig;
  /**
   * Absolute path to the `mcp-use.json` that was loaded, or `null` when no
   * config file was found (defaults-only result).
   */
  configPath: string | null;
  /**
   * The project root: the directory containing the resolved `mcp-use.json`,
   * or the starting `cwd` when no config file was found.
   */
  projectRoot: string;
}

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  /** Directory to start the upward search from. Defaults to the process cwd. */
  cwd?: string;
}

/**
 * Error thrown when a discovered `mcp-use.json` is malformed or fails schema
 * validation. Always names the offending file path.
 */
export class ConfigError extends Error {
  /** Absolute path to the config file that failed to load. */
  readonly configPath: string;

  constructor(configPath: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
    this.configPath = configPath;
  }
}

/**
 * Walk up from `startDir` to the filesystem root, returning the first
 * directory that contains a `mcp-use.json`, or `null` if none is found.
 */
async function findConfigDir(startDir: string): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");

  let current = path.resolve(startDir);
  // Loop until `dirname` stops making progress (i.e. we hit the root).
  for (;;) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Format a Zod validation failure into a single, actionable message that lists
 * each offending field path and its error.
 */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${where}: ${issue.message}`;
    })
    .join("\n");
}

/**
 * Load and validate the nearest `mcp-use.json`, applying schema defaults.
 *
 * @throws {ConfigError} if a config file is found but contains invalid JSON or
 *   fails schema validation (e.g. wrong field type, unknown top-level key).
 */
export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<LoadConfigResult> {
  const path = await import("node:path");
  const startDir = path.resolve(options.cwd ?? getCwd());

  const configDir = await findConfigDir(startDir);

  // No config file anywhere up the tree: return defaults-only.
  if (configDir === null) {
    return {
      config: configSchema.parse({}),
      configPath: null,
      projectRoot: startDir,
    };
  }

  const configPath = path.join(configDir, CONFIG_FILE_NAME);

  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(configPath, "utf8");

  let parsed: unknown;
  try {
    // JSON.parse ONLY — no code execution.
    parsed = JSON.parse(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigError(
      configPath,
      `Failed to parse ${configPath}: invalid JSON (${detail})`,
      { cause }
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      configPath,
      `Invalid config in ${configPath}:\n${formatZodError(result.error)}`,
      { cause: result.error }
    );
  }

  return {
    config: result.data,
    configPath,
    projectRoot: configDir,
  };
}
