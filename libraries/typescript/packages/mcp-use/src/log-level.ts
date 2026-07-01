/**
 * Single source of truth for the framework's log verbosity, read from the
 * `MCP_USE_LOG_LEVEL` environment variable.
 *
 * This consolidates the pre-P4 trio of `MCP_DEBUG_LEVEL`, `DEBUG`, and `VERBOSE`
 * into one namespaced variable with three levels:
 *
 * - `info`  — default; one compact line per request, normal Logger output.
 * - `debug` — adds `args=<json>` to request logs, enables Logger `debug`, and
 *   ungates the inspector's mount-failure diagnostics.
 * - `trace` — everything in `debug` plus full request/response header + body
 *   dumps (the old `DEBUG=1` behavior).
 *
 * This module is intentionally dependency-free and browser-safe so both the
 * server request logger and the cross-runtime {@link Logger} can share it.
 */

export type LogLevelName = "info" | "debug" | "trace";

/** The environment variable that controls framework log verbosity. */
export const LOG_LEVEL_ENV = "MCP_USE_LOG_LEVEL";

/**
 * Read `MCP_USE_LOG_LEVEL` in a cross-runtime way. Kept local (rather than
 * importing the server-only `runtime.getEnv`) so this stays browser-safe.
 */
function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  const deno = (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } })
    .Deno;
  if (deno?.env) {
    try {
      return deno.env.get(key);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolve the active {@link LogLevelName}.
 *
 * @param override - Optional explicit value (e.g. from a CLI flag or a test),
 *   used in place of reading the environment.
 * @returns The parsed level, defaulting to `"info"` for unset/unknown values.
 */
export function resolveLogLevel(override?: string): LogLevelName {
  const raw = (override ?? readEnv(LOG_LEVEL_ENV))?.trim().toLowerCase();
  if (raw === "info" || raw === "debug" || raw === "trace") {
    return raw;
  }
  return "info";
}

/** `true` when the resolved level is at least `debug` (i.e. `debug` or `trace`). */
export function isDebugEnabled(override?: string): boolean {
  const level = resolveLogLevel(override);
  return level === "debug" || level === "trace";
}
