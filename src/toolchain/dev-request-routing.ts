/**
 * Request-routing predicate for the dev server (issue #3025).
 *
 * The Vite client environment serves the views, the landing page (when
 * present) and every project module those import. The HTTP listener in
 * `dev.ts` must send exactly those browser module URLs to Vite and leave the
 * MCP endpoint alone. Kept here as a pure function so the routing table can be
 * unit-tested without booting a dev server, a Vite instance or a project.
 */

export interface ViteModuleRequestInput {
  /** `req.method`, undefined when the client sent no method. */
  method: string | undefined;
  /** Request pathname, always starting with "/". */
  pathname: string;
  /** True when the client environment is serving at least one view. */
  viewsEnabled: boolean;
  /**
   * URL prefix of the resolved views directory, e.g. "/views/". Undefined
   * when the directory is outside the project root (served through /@fs/).
   */
  viewsUrlPrefix: string | undefined;
  /** True when the path belongs to the browser module graph (view imports). */
  knownBrowserModule: boolean;
}

/**
 * Whether this request is a browser module URL Vite must answer.
 *
 * Views may import project files from outside their own directory; those are
 * not under the views prefix but are still in the client module graph, so the
 * module-graph answer is honoured whenever the views (or a landing page) are
 * enabled — not only when `landing.tsx` exists.
 */
export function shouldServeViteModuleRequest(
  input: ViteModuleRequestInput
): boolean {
  return (
    input.method === "GET" &&
    (input.pathname.startsWith("/@") ||
      input.pathname.startsWith("/node_modules/") ||
      input.pathname.startsWith("/.mcp-use/") ||
      isViewsRequest(input) ||
      input.knownBrowserModule)
  );
}

/**
 * Whether the path lies under the configured views directory. The prefix is
 * derived from the resolved directory, so `--views-dir src/views` and the
 * Next.js drop-in (`--mcp-dir src/mcp`) work like the conventional `views/`.
 */
export function isViewsRequest(input: ViteModuleRequestInput): boolean {
  return (
    input.viewsEnabled &&
    input.viewsUrlPrefix !== undefined &&
    input.pathname.startsWith(input.viewsUrlPrefix)
  );
}
