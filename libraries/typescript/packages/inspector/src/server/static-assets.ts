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

export function resolveInspectorAppDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [
    path.resolve(here, "app"), // dist/cli.js (bundled)
    path.resolve(here, "../app"), // dist/server/*.js
    path.resolve(here, "../../dist/app"), // src/server/*.ts (workspace dev)
  ]) {
    if (existsSync(path.join(dir, "inspector.js"))) {
      return dir;
    }
  }
  throw new Error(
    "Inspector bundle not found (expected dist/app/inspector.js)"
  );
}

/** Serve this package's installed browser bundle at a root-relative path. */
export function registerInspectorStaticAssets(
  app: Hono,
  mountPath: string = "/inspector/assets"
) {
  const appDir = resolveInspectorAppDir();

  app.get(`${mountPath}/*`, (c) => {
    const subPath = c.req.path.slice(mountPath.length);
    const relative = subPath.startsWith("/") ? subPath.slice(1) : subPath;
    if (!relative || relative.includes("..")) {
      return c.notFound();
    }
    const file = path.resolve(appDir, relative);
    const root = appDir.endsWith(path.sep) ? appDir : `${appDir}${path.sep}`;
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
