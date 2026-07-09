/**
 * Detect whether the user explicitly passed a port override to `mcp-use start`.
 *
 * `-p` is reserved for `--path`; only `--port` / `--port=<value>` should count
 * as an explicit port flag so `PORT` env precedence is preserved.
 */
export function isStartPortFlagExplicit(argv: string[]): boolean {
  return (
    argv.includes("--port") || argv.some((arg) => arg.startsWith("--port="))
  );
}
