/**
 * The single rule for joining a child path onto a server `basePath`.
 *
 * `basePath` is an absolute pathname that may be exactly `"/"`, which
 * `assertServerConfig` accepts because it rejects a trailing slash only when
 * the path is longer than one character. Interpolating the base and the child
 * directly therefore yields `"//child"` at the root, a path no client
 * requests. Every consumer joins through this helper so the CLI has one answer
 * for the root case instead of one per call site.
 *
 * @param basePath - Absolute server base pathname, possibly `"/"`.
 * @param childPath - Path to place under `basePath`, with or without a leading
 * slash.
 * @returns The joined absolute pathname, never containing an empty segment.
 *
 * @internal
 */
export function pathUnderBase(basePath: string, childPath: string): string {
  const child = childPath.replace(/^\/+/, "");
  return basePath === "/" ? `/${child}` : `${basePath}/${child}`;
}
