/**
 * Cross-runtime utilities for Node.js and Deno compatibility
 */

// Detect runtime
export const isDeno = typeof (globalThis as any).Deno !== "undefined";

/**
 * Get an environment variable in a cross-runtime compatible way
 * Works in both Node.js and Deno environments
 *
 * @param key - The environment variable key
 * @returns The value of the environment variable, or undefined if not set
 */
export function getEnv(key: string): string | undefined {
  if (isDeno) {
    return (globalThis as any).Deno.env.get(key);
  }
  return process.env[key];
}

// Helper to get current working directory
export function getCwd(): string {
  if (isDeno) {
    return (globalThis as any).Deno.cwd();
  }
  return process.cwd();
}

// Runtime-aware file system helpers
export const fsHelpers = {
  async readFileSync(path: string, encoding: string = "utf8"): Promise<string> {
    if (isDeno) {
      return await (globalThis as any).Deno.readTextFile(path);
    }
    const { readFileSync } = await import("node:fs");
    const result = readFileSync(path, encoding as any);
    return typeof result === "string"
      ? result
      : result.toString(encoding as any);
  },

  async readFile(path: string): Promise<ArrayBuffer> {
    if (isDeno) {
      const data = await (globalThis as any).Deno.readFile(path);
      return data.buffer;
    }
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(path);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
  },

  async existsSync(path: string): Promise<boolean> {
    if (isDeno) {
      try {
        await (globalThis as any).Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    }
    const { existsSync } = await import("node:fs");
    return existsSync(path);
  },

  async readdirSync(path: string): Promise<string[]> {
    if (isDeno) {
      const entries = [];
      for await (const entry of (globalThis as any).Deno.readDir(path)) {
        entries.push(entry.name);
      }
      return entries;
    }
    const { readdirSync } = await import("node:fs");
    return readdirSync(path);
  },
};

/**
 * Collapse `.`/`..` segments in a `/`-joined path. Pure and cross-runtime (no
 * `node:path`, so it stays synchronous and works in Deno).
 *
 * ponytail: lexical-only normalization — no symlink/realpath resolution. This is
 * defense-in-depth: a normalized *absolute* path can still point outside an
 * intended base dir, so handlers serving request-derived paths MUST still reject
 * traversal up front via `safeSubpath`/`safeSegment`. The real containment guard
 * lives at the route handlers, not here.
 */
function normalizePosix(path: string): string {
  const isAbsolute = path.startsWith("/");
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      // For absolute paths, a leading `..` that would escape root is dropped.
    } else {
      out.push(seg);
    }
  }
  const joined = out.join("/");
  if (isAbsolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

/**
 * Validate a request-derived static-file subpath, rejecting path traversal.
 *
 * Returns the original `raw` value when safe (so the caller reads exactly what
 * the runtime handed it), or `null` when the request must be refused. Both the
 * raw and percent-decoded views are checked so encoded `..` (e.g. `%2e%2e`) is
 * caught even on embeddings that don't pre-decode the path (e.g. mounting the
 * Hono app under Express). Mainstream runtimes (Node/Deno/Bun/Workers) already
 * collapse `..` when constructing the WHATWG Request, so this is defense-in-depth.
 */
export function safeSubpath(raw: string): string | null {
  if (raw.includes("\0")) return null;
  const views = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) views.push(decoded);
  } catch {
    // Malformed percent-encoding can't be a decoded traversal the OS resolves;
    // fall through and validate the raw form only.
  }
  for (const view of views) {
    const norm = view.replace(/\\/g, "/");
    // Reject absolute paths (POSIX root, UNC `//`, or Windows drive `C:`).
    if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) return null;
    if (norm.split("/").some((s) => s === ".." || s === ".")) return null;
  }
  return raw;
}

/**
 * Like {@link safeSubpath} but for a single path segment (e.g. a `:widget` route
 * param): additionally rejects path separators and empty input.
 */
export function safeSegment(raw: string): string | null {
  const safe = safeSubpath(raw);
  if (
    safe === null ||
    safe === "" ||
    safe.includes("/") ||
    safe.includes("\\")
  ) {
    return null;
  }
  return safe;
}

// Runtime-aware path helpers
export const pathHelpers = {
  join(...paths: string[]): string {
    // Collapse `.`/`..` and redundant slashes. Cross-runtime; see normalizePosix.
    return normalizePosix(paths.join("/"));
  },

  relative(from: string, to: string): string {
    // Simple relative path calculation
    const fromParts = from.split("/").filter((p) => p);
    const toParts = to.split("/").filter((p) => p);

    let i = 0;
    while (
      i < fromParts.length &&
      i < toParts.length &&
      fromParts[i] === toParts[i]
    ) {
      i++;
    }

    const upCount = fromParts.length - i;
    const relativeParts = [...Array(upCount).fill(".."), ...toParts.slice(i)];
    return relativeParts.join("/");
  },
};

// UUID generation helper (works in Node.js, Deno, and browsers)
// Uses the Web Crypto API which is available globally
export function generateUUID(): string {
  return (globalThis.crypto as any).randomUUID();
}
