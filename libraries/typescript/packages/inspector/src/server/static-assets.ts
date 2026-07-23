import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Hono } from "hono";
import {
  createInspectorRateLimiter,
  INSPECTOR_ASSET_RATE_LIMIT,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
} from "./rate-limit.js";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export function resolveInspectorAppDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [
    path.resolve(here, "app"), // dist/cli.js (bundled)
    path.resolve(here, "../app"), // dist/server/*.js
    path.resolve(here, "../../dist/app"), // src/server/*.ts (workspace dev)
  ]) {
    if (existsSync(path.join(dir, "inspector.js.gz"))) {
      return dir;
    }
  }
  throw new Error(
    "Inspector bundle not found (expected dist/app/inspector.js.gz)"
  );
}

/** Serve this package's installed browser bundle at a root-relative path. */
export function registerInspectorStaticAssets(
  app: Hono,
  mountPath: string = "/inspector/assets"
) {
  const appDir = resolveInspectorAppDir();
  const identityCache = new Map<string, Buffer>();

  app.use(
    `${mountPath}/*`,
    createInspectorRateLimiter({
      points: INSPECTOR_ASSET_RATE_LIMIT,
      durationSeconds: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
      key: "inspector-assets",
    })
  );

  app.get(`${mountPath}/*`, (c) => {
    const subPath = c.req.path.slice(mountPath.length);
    const relative = subPath.startsWith("/") ? subPath.slice(1) : subPath;
    if (!relative || relative.includes("..")) {
      return c.notFound();
    }
    const compressedRelative =
      relative === "inspector.js" || relative === "inspector.css"
        ? `${relative}.gz`
        : relative;
    const file = path.resolve(appDir, compressedRelative);
    const root = appDir.endsWith(path.sep) ? appDir : `${appDir}${path.sep}`;
    if (!file.startsWith(root) || !existsSync(file)) {
      return c.notFound();
    }
    const ext = path.extname(relative);
    const compressed = compressedRelative.endsWith(".gz");
    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(
      c.req.header("accept-encoding") ?? ""
    );
    const bytes = readFileSync(file);
    const body =
      compressed && !acceptsGzip
        ? (identityCache.get(file) ?? cacheGunzip(identityCache, file, bytes))
        : bytes;
    const data = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer;
    return c.body(data, 200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      ...(compressed && acceptsGzip ? { "Content-Encoding": "gzip" } : {}),
      ...(compressed ? { Vary: "Accept-Encoding" } : {}),
      // Standalone assets use stable URLs across CLI restarts. Revalidate them
      // so a rebuilt or upgraded Inspector cannot keep running an hour-old UI
      // bundle that predates its storage migrations or proxy contract.
      "Cache-Control": "no-cache",
    });
  });
}

function cacheGunzip(
  cache: Map<string, Buffer>,
  file: string,
  bytes: Buffer
): Buffer {
  const identity = gunzipSync(bytes);
  cache.set(file, identity);
  return identity;
}
