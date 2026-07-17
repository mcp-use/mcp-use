const PUBLIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Resolve a request subpath to an on-disk file under `publicRoot`, rejecting
 * path traversal.
 *
 * @param publicRoot - Absolute path to the `public/` directory on disk.
 * @param subpath - Request path after the `/public/` route prefix.
 * @returns Absolute file path when safe and present, otherwise `null`.
 *
 * @internal
 */
export async function resolvePublicFilePath(
  publicRoot: string,
  subpath: string
): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const { resolve, sep } = await import("node:path");

  if (subpath === "" || subpath.includes("..") || subpath.includes("\\")) {
    return null;
  }
  const clean = subpath.replace(/^\/+/, "");
  if (clean === "" || clean.endsWith("/")) {
    return null;
  }
  const root = resolve(publicRoot);
  const abs = resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + sep)) {
    return null;
  }
  if (!existsSync(abs)) {
    return null;
  }
  return abs;
}

/**
 * Serve one file from the project's `public/` directory.
 *
 * @param diskPath - Absolute path resolved by {@link resolvePublicFilePath}.
 * @param options - When `deferCors` is true, omit hardcoded `ACAO: *` so global
 *   {@link ServerConfig.cors} middleware owns CORS headers.
 * @returns A `Response` with `Cache-Control: public, max-age=0, must-revalidate`
 * and optionally `Access-Control-Allow-Origin: *` so cross-origin sandboxed
 * view iframes can load public files (module scripts and fetches use CORS mode).
 *
 * @internal
 */
export async function servePublicFile(
  diskPath: string,
  options: { deferCors?: boolean } = {}
): Promise<Response> {
  const { createReadStream } = await import("node:fs");
  const { extname } = await import("node:path");
  const { Readable } = await import("node:stream");

  const ext = extname(diskPath);
  const contentType = PUBLIC_CONTENT_TYPES[ext] ?? "application/octet-stream";
  const nodeStream = createReadStream(diskPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=0, must-revalidate",
      ...(options.deferCors !== true && {
        "Access-Control-Allow-Origin": "*",
      }),
    },
  });
}
