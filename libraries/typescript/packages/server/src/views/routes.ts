import {
  matchesPathPrefix,
  pathUnderBase,
  pathnameOf,
  type FetchHandler,
} from "../fetch-app.js";
import type { ViewManifestEntry } from "./types.js";

const PUBLIC_BUILD_DIR = ".mcp-use/build/views/public";
const PUBLIC_DEV_DIR = "public";
const VIEW_ASSETS_BUILD_ROOT = ".mcp-use/build/views";

/**
 * Fetch handler for built view bundles under
 * `${basePath}/_mcp-use/views/<name>/…`.
 *
 * Production only — dev serves view modules through Vite middleware.
 *
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param views - Primed view registry; empty skips mounting.
 * @param options - `projectRoot` defaults to `process.cwd()`.
 *
 * @internal
 */
export function createViewAssetsHandler(
  basePath: string,
  views: ReadonlyMap<string, ViewManifestEntry>,
  options?: { projectRoot?: string; deferCors?: boolean }
): FetchHandler | undefined {
  if (views.size === 0) {
    return undefined;
  }

  const assetsPrefix = pathUnderBase(basePath, "_mcp-use/views");
  const projectRoot = options?.projectRoot ?? process.cwd();

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!matchesPathPrefix(request, assetsPrefix)) {
      return new Response("Not Found", { status: 404 });
    }

    const pathname = pathnameOf(request);
    const remainder = pathname.slice(assetsPrefix.length + 1);
    const slash = remainder.indexOf("/");
    if (slash <= 0 || slash === remainder.length - 1) {
      return new Response("Not Found", { status: 404 });
    }

    const viewName = remainder.slice(0, slash);
    const subpath = remainder.slice(slash + 1);
    const entry = views.get(viewName);
    if (entry === undefined || entry.kind !== "external") {
      return new Response("Not Found", { status: 404 });
    }

    const [{ join }, { resolvePublicFilePath, servePublicFile }] =
      await Promise.all([import("node:path"), import("./public-route.js")]);
    const viewRoot = join(projectRoot, VIEW_ASSETS_BUILD_ROOT, viewName);
    const diskPath = await resolvePublicFilePath(viewRoot, subpath);
    if (diskPath === null) {
      return new Response("Not Found", { status: 404 });
    }
    return await servePublicFile(diskPath, {
      ...(options?.deferCors === true && { deferCors: true }),
      ...(request.method === "HEAD" && { head: true }),
    });
  };
}

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
 *   `projectRoot` defaults to `process.cwd()`. `enabled` mounts the shared
 *   public route for local server branding even when no views are registered.
 *
 * @internal
 */
export function createViewPublicHandler(
  basePath: string,
  views: ReadonlyMap<string, ViewManifestEntry>,
  options?: {
    dev?: boolean;
    projectRoot?: string;
    deferCors?: boolean;
    enabled?: boolean;
  }
): FetchHandler | undefined {
  if (views.size === 0 && options?.enabled !== true) {
    return undefined;
  }

  const publicPrefix = pathUnderBase(basePath, "_mcp-use/public");
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
    const encodedSubpath = pathname.slice(publicPrefix.length + 1);
    let subpath: string;
    try {
      subpath = decodeURIComponent(encodedSubpath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
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
    return await servePublicFile(diskPath, {
      ...(options?.deferCors === true && { deferCors: true }),
      ...(request.method === "HEAD" && { head: true }),
    });
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
