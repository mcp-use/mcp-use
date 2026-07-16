import {
  matchesPathPrefix,
  pathnameOf,
  type FetchHandler,
} from "../fetch-app.js";
import type { ViewManifestEntry } from "./types.js";

const PUBLIC_BUILD_DIR = ".mcp-use/build/views/public";
const PUBLIC_DEV_DIR = "public";

/**
 * Fetch handler for public view assets under `${basePath}/_mcp-use/public/`.
 *
 * Public responses include `Access-Control-Allow-Origin: *` for
 * cross-origin sandboxed view iframes.
 *
 * Node filesystem modules load only on the first public-asset request so the
 * library entry stays edge-safe for `getHandler()`-only deployments.
 *
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param views - Primed view registry; empty skips mounting.
 * @param options - When `dev` is true, the public route reads from
 *   `<projectRoot>/public` instead of `.mcp-use/build/views/public/`.
 *   `projectRoot` defaults to `process.cwd()`.
 *
 * @internal
 */
export function createViewPublicHandler(
  basePath: string,
  views: ReadonlyMap<string, ViewManifestEntry>,
  options?: { dev?: boolean; projectRoot?: string }
): FetchHandler | undefined {
  if (views.size === 0) {
    return undefined;
  }

  const publicPrefix = `${basePath}/_mcp-use/public`;
  const subdir = options?.dev === true ? PUBLIC_DEV_DIR : PUBLIC_BUILD_DIR;
  const projectRoot = options?.projectRoot ?? process.cwd();

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!matchesPathPrefix(request, publicPrefix)) {
      return new Response("Not Found", { status: 404 });
    }

    const pathname = pathnameOf(request);
    const subpath = pathname.slice(publicPrefix.length + 1);
    if (subpath.length === 0) {
      return new Response("Not Found", { status: 404 });
    }

    const [{ join }, { resolvePublicFilePath, servePublicFile }] =
      await Promise.all([import("node:path"), import("./public-route.js")]);
    const publicRoot = join(projectRoot, subdir);
    const diskPath = await resolvePublicFilePath(publicRoot, subpath);
    if (diskPath === null) {
      return new Response("Not Found", { status: 404 });
    }
    return await servePublicFile(diskPath);
  };
}

/**
 * @deprecated Use {@link createViewPublicHandler}.
 *
 * @internal
 */
export function mountViewRoutes(): void {
  throw new Error(
    "mountViewRoutes(app) was removed — use createViewPublicHandler"
  );
}
