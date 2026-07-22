import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export function resolveDistCdnDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [
    path.resolve(here, "cdn"), // dist/cli.js (bundled)
    path.resolve(here, "../cdn"), // dist/server/*.js
    path.resolve(here, "../../dist/cdn"), // src/server/*.ts (workspace dev)
  ]) {
    if (existsSync(path.join(dir, "inspector.js"))) {
      return dir;
    }
  }
  throw new Error(
    "Inspector bundle not found (expected dist/cdn/inspector.js)"
  );
}

/** Serve this package's `dist/cdn` files at a root-relative mount path. */
export function registerInspectorStaticAssets(
  app: Hono,
  mountPath: string = "/dist/cdn"
) {
  const cdnDir = resolveDistCdnDir();

  app.get(`${mountPath}/*`, (c) => {
    const subPath = c.req.path.slice(mountPath.length);
    const relative = subPath.startsWith("/") ? subPath.slice(1) : subPath;
    if (!relative || relative.includes("..")) {
      return c.notFound();
    }
    const file = path.resolve(cdnDir, relative);
    const root = cdnDir.endsWith(path.sep) ? cdnDir : `${cdnDir}${path.sep}`;
    if (!file.startsWith(root) || !existsSync(file)) {
      return c.notFound();
    }
    const ext = path.extname(file);
    return c.body(readFileSync(file), 200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // Standalone assets use stable URLs across CLI restarts. Revalidate them
      // so a rebuilt or upgraded Inspector cannot keep running an hour-old UI
      // bundle that predates its storage migrations or proxy contract.
      "Cache-Control": "no-cache",
    });
  });
}
