import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { INSPECTOR_FAVICON_ASSETS } from "./favicon-links.js";

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function resolveFaviconDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [
    path.resolve(here, "../cdn"),
    path.resolve(here, "../../public"),
  ]) {
    if (existsSync(path.join(dir, "favicon-black.svg"))) {
      return dir;
    }
  }
  throw new Error("Inspector favicon assets not found (expected dist/cdn or public/)");
}

/** Serve favicon assets from the local package (not inspector-cdn). */
export function registerInspectorFaviconStatic(
  app: Hono,
  basePath: string = ""
) {
  const faviconDir = resolveFaviconDir();
  const p = (suffix: string) => `${basePath}${suffix}`;

  for (const file of INSPECTOR_FAVICON_ASSETS) {
    app.get(p(`/${file}`), (c) => {
      try {
        const data = readFileSync(path.join(faviconDir, file));
        const ext = path.extname(file);
        return c.body(data, 200, {
          "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        });
      } catch {
        return c.notFound();
      }
    });
  }
}
