import {
  matchesPathPrefix,
  pathUnderBase,
  pathnameOf,
  type FetchHandler,
} from "../fetch-app.js";
import type { EmbeddedViewAssets, ViewManifestEntry } from "./types.js";

const PUBLIC_BUILD_DIR = ".mcp-use/build/views/public";
const PUBLIC_DEV_DIR = "public";
const VIEW_ASSETS_BUILD_ROOT = ".mcp-use/build/views";
const LANDING_ASSETS_BUILD_ROOT = ".mcp-use/build/landing";

const decodedAssets = new WeakMap<object, Uint8Array<ArrayBuffer>>();

function serveEmbeddedAsset(
  assets: EmbeddedViewAssets,
  path: string,
  request: Request,
  deferCors: boolean | undefined
): Response {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (decoded.includes("\\") || decoded.split("/").includes("..")) {
    return new Response("Not Found", { status: 404 });
  }
  const asset = Object.hasOwn(assets, decoded) ? assets[decoded] : undefined;
  if (asset === undefined) return new Response("Not Found", { status: 404 });
  let body: Uint8Array<ArrayBuffer> | null = null;
  if (request.method !== "HEAD") {
    body = decodedAssets.get(asset) ?? null;
    if (body === null) {
      body = Uint8Array.from(atob(asset.body), (character) =>
        character.charCodeAt(0)
      );
      decodedAssets.set(asset, body);
    }
  }
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=0, must-revalidate",
      ...(deferCors !== true && { "Access-Control-Allow-Origin": "*" }),
    },
  });
}

/**
 * Serve generated client-bundle files under `${basePath}/<route>/…`: from
 * embedded assets when supplied (each decoded once), otherwise from
 * `<projectRoot>/<directory>` on disk.
 *
 * Node filesystem modules load only on the first disk request so the library
 * entry stays edge-safe for `server.fetch` deployments.
 */
function createBundleAssetsHandler(
  basePath: string,
  route: string,
  directory: string,
  options: {
    projectRoot?: string;
    deferCors?: boolean;
    assets?: EmbeddedViewAssets;
    /** Rejects encoded paths, relative to `directory`, outside the bundle. */
    accepts?: (path: string) => boolean;
  }
): FetchHandler {
  const prefix = pathUnderBase(basePath, route);
  const projectRoot = options.projectRoot ?? process.cwd();

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!matchesPathPrefix(request, prefix)) {
      return new Response("Not Found", { status: 404 });
    }

    const encodedPath = pathnameOf(request).slice(prefix.length + 1);
    if (encodedPath === "" || options.accepts?.(encodedPath) === false) {
      return new Response("Not Found", { status: 404 });
    }

    if (options.assets !== undefined) {
      return serveEmbeddedAsset(
        options.assets,
        encodedPath,
        request,
        options.deferCors
      );
    }

    let path: string;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    const [{ join }, { resolvePublicFilePath, servePublicFile }] =
      await Promise.all([import("node:path"), import("./public-route.js")]);
    const diskPath = await resolvePublicFilePath(
      join(projectRoot, directory),
      path
    );
    if (diskPath === null) {
      return new Response("Not Found", { status: 404 });
    }
    return await servePublicFile(diskPath, {
      ...(options.deferCors === true && { deferCors: true }),
      ...(request.method === "HEAD" && { head: true }),
    });
  };
}

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
  options?: {
    projectRoot?: string;
    deferCors?: boolean;
    assets?: EmbeddedViewAssets;
  }
): FetchHandler | undefined {
  if (views.size === 0) {
    return undefined;
  }

  return createBundleAssetsHandler(
    basePath,
    "_mcp-use/views",
    VIEW_ASSETS_BUILD_ROOT,
    {
      ...options,
      accepts: (path) => {
        const slash = path.indexOf("/");
        if (slash <= 0 || slash === path.length - 1) {
          return false;
        }
        return views.get(path.slice(0, slash))?.kind === "external";
      },
    }
  );
}

/**
 * Fetch handler for the built landing-page hydration bundle under
 * `${basePath}/_mcp-use/landing/…`, sharing the view bundle code path.
 *
 * Production only — dev serves the landing entry through Vite middleware.
 *
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param options - `projectRoot` defaults to `process.cwd()`; `assets` keys
 *   are paths relative to `.mcp-use/build/landing/`.
 *
 * @internal
 */
export function createLandingAssetsHandler(
  basePath: string,
  options?: {
    projectRoot?: string;
    deferCors?: boolean;
    assets?: EmbeddedViewAssets;
  }
): FetchHandler {
  return createBundleAssetsHandler(
    basePath,
    "_mcp-use/landing",
    LANDING_ASSETS_BUILD_ROOT,
    options ?? {}
  );
}

/**
 * Fetch handler for public view assets under `${basePath}/_mcp-use/public/`.
 *
 * Public responses include `Access-Control-Allow-Origin: *` for
 * cross-origin sandboxed view iframes.
 *
 * Node filesystem modules load only on the first public-asset request so the
 * library entry stays edge-safe for `server.fetch` deployments.
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
    assets?: EmbeddedViewAssets;
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

    if (options?.assets !== undefined) {
      return serveEmbeddedAsset(
        options.assets,
        `public/${encodedSubpath}`,
        request,
        options.deferCors
      );
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
