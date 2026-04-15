/**
 * Per-project config loader for mcp-use CLI.
 *
 * Enables embedding an MCP server in a non-standard project structure
 * (e.g. inside a Next.js app) by reading mcp-use.config.json or CLI flags.
 *
 * This file would live at:
 *   libraries/typescript/packages/cli/src/utils/project-config.ts
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface ProjectConfig {
  /** Path to the MCP server entry file, relative to project root. */
  entry?: string;

  /** Path to the widgets directory, relative to project root. */
  widgetsDir?: string;

  /**
   * Path to the folder that holds the MCP server entry + resources,
   * relative to project root.
   *
   * This is the "drop-in" convention for embedding an MCP server inside
   * an existing app (typically a Next.js repo) — set this to e.g. "src/mcp"
   * and the CLI will look for `src/mcp/index.ts` as the entry and
   * `src/mcp/resources` as the widgets directory.
   *
   * `entry` and `widgetsDir` (or the `--entry` / `--widgets-dir` flags) take
   * precedence when set.
   */
  mcpDir?: string;

  /** Default port for dev/start servers. */
  port?: number;

  /**
   * Optional tsconfig paths override — useful when the project's
   * tsconfig has path aliases the CLI should honor during widget builds.
   * Defaults to reading the project's tsconfig.json.
   */
  tsconfigPath?: string;
}

const CONFIG_FILENAME = "mcp-use.config.json";

/**
 * Load mcp-use.config.json from a project directory.
 *
 * Returns an empty object when the file is absent. A malformed JSON file is
 * re-thrown with a clear error message instead of being silently ignored —
 * a typo in the config would otherwise surface as "entry file not found"
 * later, which is much harder to debug.
 */
export async function loadProjectConfig(
  projectPath: string
): Promise<ProjectConfig> {
  const configPath = path.join(projectPath, CONFIG_FILENAME);

  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (error: unknown) {
    // Missing file is the happy path (config file is optional).
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }

  try {
    return JSON.parse(content) as ProjectConfig;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Resolve the MCP directory (the folder holding the server entry + resources).
 * Priority: CLI flag > config file > undefined (not set — use legacy layout).
 */
export function resolveMcpDir(
  cliMcpDir: string | undefined,
  config: ProjectConfig
): string | undefined {
  return cliMcpDir ?? config.mcpDir;
}

/**
 * Resolve the entry file for an MCP server.
 * Priority: CLI --entry > config.entry > <mcpDir>/index.ts > default search.
 */
export async function resolveEntryFile(
  projectPath: string,
  cliEntry: string | undefined,
  config: ProjectConfig,
  mcpDir?: string
): Promise<string> {
  // 1. CLI --entry flag wins
  if (cliEntry) {
    await assertExists(path.join(projectPath, cliEntry), cliEntry);
    return cliEntry;
  }

  // 2. config.entry
  if (config.entry) {
    await assertExists(path.join(projectPath, config.entry), config.entry);
    return config.entry;
  }

  // 3. mcpDir-scoped defaults — drop-in Next.js layout
  if (mcpDir) {
    const mcpCandidates = [
      path.join(mcpDir, "index.ts"),
      path.join(mcpDir, "index.tsx"),
      path.join(mcpDir, "server.ts"),
      path.join(mcpDir, "server.tsx"),
    ];
    for (const candidate of mcpCandidates) {
      try {
        await fs.access(path.join(projectPath, candidate));
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error(
      `No entry file found inside ${mcpDir}.\n\n` +
        `Expected one of: ${mcpCandidates.map((c) => path.relative(projectPath, path.join(projectPath, c))).join(", ")}\n\n` +
        `Fix this by either:\n` +
        `  1. Creating ${path.join(mcpDir, "index.ts")}, or\n` +
        `  2. Passing --entry <file> on the command line, or\n` +
        `  3. Adding { "entry": "<file>" } to ${CONFIG_FILENAME}`
    );
  }

  // 4. Default search — legacy mcp-use convention (top-level)
  const candidates = ["index.ts", "src/index.ts", "server.ts", "src/server.ts"];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `No entry file found.\n\n` +
      `Expected one of: ${candidates.join(", ")}\n\n` +
      `Fix this by either:\n` +
      `  1. Creating one of the default entry files above, or\n` +
      `  2. Passing --entry <file> on the command line, or\n` +
      `  3. Adding { "entry": "<file>" } or { "mcpDir": "<dir>" } to ${CONFIG_FILENAME}`
  );
}

/**
 * Resolve the widgets directory.
 * Priority: CLI --widgets-dir > config.widgetsDir > <mcpDir>/resources > "resources".
 */
export function resolveWidgetsDir(
  cliWidgetsDir: string | undefined,
  config: ProjectConfig,
  mcpDir?: string
): string {
  if (cliWidgetsDir) return cliWidgetsDir;
  if (config.widgetsDir) return config.widgetsDir;
  if (mcpDir) return path.join(mcpDir, "resources");
  return "resources";
}

/**
 * Parse a port value from an arbitrary CLI flag / env var / config value.
 *
 * Returns `undefined` for anything that isn't a valid TCP port so callers
 * can fall through to the next candidate instead of silently advertising
 * `NaN` or out-of-range values.
 */
function parsePortValue(
  value: string | number | undefined
): number | undefined {
  if (value === undefined) return undefined;
  const port = typeof value === "string" ? parseInt(value, 10) : value;
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;
  return port;
}

/**
 * Resolve the port for dev/start servers.
 * Priority: CLI flag > env var (PORT) > config file > default (3000).
 * Invalid values at each level (non-numeric, out-of-range) skip that level
 * and fall through to the next candidate.
 */
export function resolvePort(
  cliPort: string | number | undefined,
  config: ProjectConfig,
  defaultPort: number = 3000
): number {
  const resolvedCli = parsePortValue(cliPort);
  if (resolvedCli !== undefined) return resolvedCli;

  const resolvedEnv = parsePortValue(process.env.PORT);
  if (resolvedEnv !== undefined) return resolvedEnv;

  const resolvedConfig = parsePortValue(config.port);
  if (resolvedConfig !== undefined) return resolvedConfig;

  return defaultPort;
}

async function assertExists(absPath: string, displayPath: string) {
  try {
    await fs.access(absPath);
  } catch {
    throw new Error(`File not found: ${displayPath}`);
  }
}
