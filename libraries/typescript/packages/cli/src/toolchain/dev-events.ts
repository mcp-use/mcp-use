/**
 * Events pieces of `mcp-use dev` (WP-27): the plain-data dev-runtime handoff
 * and the tunnel rules. Kept free of heavy imports so it is testable alone.
 */
import { pathUnderBase } from "../base-path.js";
import { isInspectorPath } from "./inspector-route.js";

/**
 * Plain data passed to `server.__setEventsDev` on every generation (D44).
 * Mirrors `EventsDevOptions` in `mcp-use`; the CLI never passes classes.
 */
export interface EventsDevHandoff {
  /** Absolute `.mcp-use/state` directory; the dev runtime key. */
  stateDir: string;
  /** Local dev server port. */
  devPort: number;
  /** MCP base path. */
  basePath: string;
  /** Tunnel origin while `--tunnel` is active. */
  publicOrigin?: string;
  /** Random per-process dev token (D41). */
  token: string;
}

/** What the dev listener does with a request that arrived through the tunnel host. */
export type TunnelPathDecision = "allow" | "block";

/**
 * Tunnel rules (PLAN §11.2, D33, D41). Through the tunnel host, exactly
 * `POST {base}/inspector/api/events/hooks/*` reaches the Inspector; every other
 * Inspector path and every `{base}/_mcp-use/events/*` internal route is 404.
 * Everything else (the MCP endpoint, including `events/stream`) passes.
 */
export function tunnelPathDecision(
  method: string,
  pathname: string,
  basePath: string
): TunnelPathDecision {
  const hooksPrefix = `${pathUnderBase(basePath, "inspector")}/api/events/hooks/`;
  if (
    method.toUpperCase() === "POST" &&
    pathname.startsWith(hooksPrefix) &&
    pathname.length > hooksPrefix.length
  ) {
    return "allow";
  }
  if (isInspectorPath(pathname, basePath)) return "block";
  const internal = pathUnderBase(basePath, "_mcp-use/events");
  if (pathname === internal || pathname.startsWith(`${internal}/`)) {
    return "block";
  }
  return "allow";
}
