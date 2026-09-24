import {
  matchesPathPrefix,
  pathUnderBase,
  pathnameOf,
  type FetchHandler,
} from "./fetch-app.js";
import type { LandingPageRegistration } from "./landing.js";

const LANDING_BUILD_DIR = ".mcp-use/build/landing";

/** Serve CLI-built hydration modules and stylesheets. @internal */
export function createLandingAssetsHandler(
  basePath: string,
  registration: LandingPageRegistration,
  deferCors?: boolean
): FetchHandler {
  const prefix = pathUnderBase(basePath, "_mcp-use/landing");
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!matchesPathPrefix(request, prefix)) {
      return new Response("Not Found", { status: 404 });
    }
    const encoded = pathnameOf(request).slice(prefix.length + 1);
    let subpath: string;
    try {
      subpath = decodeURIComponent(encoded);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    if (
      subpath === "" ||
      subpath.includes("\\") ||
      subpath.split("/").includes("..")
    ) {
      return new Response("Not Found", { status: 404 });
    }

    if (registration.assets !== undefined) {
      const asset = Object.hasOwn(registration.assets, subpath)
        ? registration.assets[subpath]
        : undefined;
      if (asset === undefined) {
        return new Response("Not Found", { status: 404 });
      }
      const body =
        request.method === "HEAD"
          ? null
          : Uint8Array.from(atob(asset.body), (char) => char.charCodeAt(0));
      return new Response(body, {
        headers: {
          "Content-Type": asset.contentType,
          "Cache-Control": "public, max-age=0, must-revalidate",
          ...(deferCors !== true && { "Access-Control-Allow-Origin": "*" }),
        },
      });
    }

    const [{ join }, { resolvePublicFilePath, servePublicFile }] =
      await Promise.all([
        import("node:path"),
        import("./views/public-route.js"),
      ]);
    const root = join(
      registration.projectRoot ?? process.cwd(),
      LANDING_BUILD_DIR
    );
    const diskPath = await resolvePublicFilePath(root, subpath);
    if (diskPath === null) {
      return new Response("Not Found", { status: 404 });
    }
    return servePublicFile(diskPath, {
      ...(deferCors === true && { deferCors: true }),
      ...(request.method === "HEAD" && { head: true }),
    });
  };
}
