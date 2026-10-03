/**
 * Shared routing predicate for Inspector mounts on CLI-owned HTTP listeners.
 *
 * The Inspector package owns its Fetch handler; the CLI only decides whether
 * a request belongs to its `<basePath>/inspector` mount.
 */
import { pathUnderBase } from "../base-path.js";

/** Whether a request targets the Inspector mount. */
export function isInspectorRequest(
  request: Request,
  basePath: string
): boolean {
  return isInspectorPath(new URL(request.url).pathname, basePath);
}

/** Whether a URL pathname belongs to the Inspector mount. */
export function isInspectorPath(pathname: string, basePath: string): boolean {
  const inspectorPath = pathUnderBase(basePath, "inspector");
  return pathname === inspectorPath || pathname.startsWith(`${inspectorPath}/`);
}
