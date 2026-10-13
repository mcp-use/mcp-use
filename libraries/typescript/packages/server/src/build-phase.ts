/**
 * Whether the code runs inside `mcp-use build`.
 *
 * The build evaluates the server entry and mounts the server to check views
 * and collect Skills, but it serves no requests. Code at module scope can use
 * this to skip what only a running server needs, such as reading secrets or
 * connecting to a database. `oauthProxy` and the storage adapters already
 * skip their own checks for those while building.
 *
 * @returns `true` while `mcp-use build` evaluates the entry (it sets
 * `MCP_USE_PHASE=build`), otherwise `false`.
 *
 * @example
 * ```ts
 * import { isBuilding } from "mcp-use";
 *
 * function requireEnv(name: string): string {
 *   const value = process.env[name];
 *   if (value) return value;
 *   if (isBuilding()) return "";
 *   throw new Error(`${name} must be set`);
 * }
 * ```
 */
export function isBuilding(): boolean {
  // Workers and browsers have no `process` unless a compatibility layer adds it.
  if (typeof process === "undefined" || process.env === undefined) {
    return false;
  }
  return process.env["MCP_USE_PHASE"] === "build";
}
