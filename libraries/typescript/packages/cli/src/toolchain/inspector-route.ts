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

/**
 * Whether a request is a delivery to the Inspector's MCP Events webhook inbox
 * (`POST <inspector>/api/events/hooks/<id>`): the only Inspector path served
 * through a tunnel, so callbacks from a remote server can reach it.
 */
export function isInspectorEventsHook(
  method: string,
  pathname: string,
  basePath: string
): boolean {
  const prefix = `${pathUnderBase(basePath, "inspector")}/api/events/hooks/`;
  return (
    method.toUpperCase() === "POST" &&
    pathname.startsWith(prefix) &&
    pathname.length > prefix.length
  );
}
