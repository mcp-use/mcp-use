import { create } from "tar";
import type { Readable } from "node:stream";

/**
 * Directories never worth uploading (build output, deps, VCS, local state).
 */
const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  "coverage",
  ".mcp-use",
]);

/**
 * Pack a project directory into a gzip tarball for upload to the cloud
 * `POST /servers` (managed) / `POST /servers/:id/source` endpoints.
 *
 * Every entry is nested under a single wrapper directory (`prefix`) because the
 * backend's extractor strips the first path segment (it expects GitHub's
 * `owner-repo-sha/` tarball layout). Secrets (`.env*`) and heavy/derived
 * directories are excluded.
 */
export async function packProjectTarball(
  projectDir: string,
  prefix = "app"
): Promise<Buffer> {
  const stream = create(
    {
      gzip: true,
      cwd: projectDir,
      prefix,
      portable: true,
      filter: (entryPath: string) => {
        const segments = entryPath.split(/[/\\]/).filter((s) => s && s !== ".");
        if (segments.some((seg) => EXCLUDE_DIRS.has(seg))) return false;
        const base = segments[segments.length - 1] ?? "";
        if (base === ".DS_Store") return false;
        // Never ship local secrets; env vars are passed explicitly via --env.
        if (base === ".env" || base.startsWith(".env.")) return false;
        return true;
      },
    },
    ["."]
  ) as unknown as Readable;

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/** Coerce an arbitrary project name into a valid GitHub repo name. */
export function sanitizeRepoName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || "mcp-server";
}
