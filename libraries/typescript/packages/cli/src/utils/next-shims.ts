/**
 * Next.js runtime-module shim wiring.
 *
 * When the CLI runs an MCP server that lives inside a Next.js app (the
 * `src/mcp/` drop-in layout), transitive imports from the user's tools
 * almost always pull in Next.js server-runtime modules:
 *
 *   - `server-only` — throws on import outside an RSC
 *   - `next/cache` — revalidatePath / unstable_cache
 *   - `next/headers` — headers() / cookies()
 *   - `next/navigation` — redirect() / notFound()
 *   - `next/server` — NextResponse / NextRequest
 *
 * These are all meaningful only inside a Next.js request; outside of one
 * (i.e., in our MCP server process) they're either unusable or useless.
 * Rather than asking the developer to write shim files, the CLI detects
 * Next.js and installs an ESM loader hook that resolves these specifiers to
 * no-op / inert implementations.
 *
 * Detection: presence of `next` in the user's package.json dependencies or
 * devDependencies.
 *
 * Registration happens in two places:
 *   1. HMR dev mode — inline, via `module.register()` in the parent process
 *      before `tsImport` is called.
 *   2. --no-hmr and build — via `NODE_OPTIONS=--import=<register.mjs>` on the
 *      spawned tsx/esbuild process.
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Returns true when the project has `next` listed in package.json deps.
 *
 * Missing / unreadable package.json returns false silently — the shims are
 * strictly additive, so "can't decide" should mean "don't shim".
 */
export async function detectNextJsProject(
  projectPath: string
): Promise<boolean> {
  try {
    const pkgPath = path.join(projectPath, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    return "next" in deps || "next" in devDeps;
  } catch {
    return false;
  }
}

/**
 * Load Next.js's environment-file cascade into `process.env`.
 *
 * Next.js's dev server reads env files in this priority order (highest
 * wins): `.env.development.local` → `.env.local` → `.env.development` →
 * `.env`. Tools imported from a Next.js app usually assume these variables
 * are populated, so the MCP CLI mirrors the same cascade when it runs
 * inside a Next.js project.
 *
 * The values we set here flow to the spawned tsx child through
 * `runCommand`'s `...process.env` merge.
 */
export async function loadNextJsEnvFiles(projectPath: string): Promise<void> {
  // Lowest priority first — later loads only fill in missing keys.
  const files = [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ];

  // dotenv is already a dependency of the CLI.
  const dotenv = await import("dotenv");
  for (const file of files) {
    const abs = path.join(projectPath, file);
    try {
      await fs.access(abs);
    } catch {
      continue;
    }
    // `override: true` because we process files in ascending priority order;
    // the more specific file should win over the less specific one.
    dotenv.config({ path: abs, override: true, quiet: true });
  }
}

/**
 * Dirname of this module at runtime, for both CJS and ESM builds.
 *
 * tsup emits a CJS build that defines `__dirname` natively, plus an ESM
 * build where we have to derive it. The `typeof` guard avoids a ReferenceError
 * when the CJS build is loaded, and the `import.meta.url` branch only
 * executes in the ESM build.
 */
function getThisDir(): string {
  if (typeof __dirname === "string") return __dirname;
  const url: string = import.meta.url;
  return path.dirname(fileURLToPath(url));
}

/**
 * Resolve the absolute path to a shim file shipped with the CLI.
 *
 * Returns the first candidate that actually exists on disk. We search a few
 * locations to cover:
 *   - tsup-built dist (`dist/shims/*.mjs` — copied via `publicDir`)
 *   - running tests from the repo with TS source (`src/shims/*.mjs`)
 */
function resolveShimPath(filename: string): string | undefined {
  const thisDir = getThisDir();
  const candidates = [
    // Production: `dist/` next to this module
    path.join(thisDir, "shims", filename),
    // Test / dev: one level up (e.g., from `dist/utils/` back to `src/shims/`)
    path.join(thisDir, "..", "shims", filename),
    path.join(thisDir, "..", "..", "src", "shims", filename),
    path.join(thisDir, "..", "src", "shims", filename),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Absolute path to the `--import=<path>` ESM registration script. */
function getShimRegisterPath(): string | undefined {
  return resolveShimPath("next-shims-register.mjs");
}

/** Absolute path to the ESM loader module itself. */
function getShimLoaderPath(): string | undefined {
  return resolveShimPath("next-shims-loader.mjs");
}

/**
 * Absolute path to the CJS-side shim preload. Patches `Module._resolveFilename`
 * so CommonJS `require("server-only")` etc. route to a no-op module instead of
 * throwing. tsx compiles TypeScript to CJS by default, so this covers the
 * path the ESM loader hook cannot reach.
 */
function getShimCjsPreloadPath(): string | undefined {
  return resolveShimPath("next-shims-cjs.cjs");
}

/**
 * Register the shim loader in the CURRENT Node.js process.
 *
 * Used by the HMR dev path, which imports the user's entry via
 * `tsx/esm/api.tsImport` in-process (no child process). We install both:
 *
 *   - The ESM loader hook (handles `import ...` of shimmed specifiers)
 *   - The CJS `Module._resolveFilename` patch (handles `require(...)`, which
 *     tsx emits when transpiling TypeScript to CommonJS)
 *
 * Returns `true` if at least one half succeeded, `false` only when neither
 * shim file can be located (graceful degradation — dev still works, users
 * just see the raw Next.js error on `server-only` etc.).
 */
export async function registerNextShimsInProcess(): Promise<boolean> {
  let anyRegistered = false;

  // CJS side first — runs synchronously, patches Module._resolveFilename.
  const cjsPath = getShimCjsPreloadPath();
  if (cjsPath) {
    // createRequire handles .cjs loading from any module context.
    const { createRequire } = await import("node:module");
    const req = createRequire(pathToFileURL(getThisDir() + path.sep).href);
    req(cjsPath);
    anyRegistered = true;
  }

  // ESM side — installs a loader hook via module.register.
  const loaderPath = getShimLoaderPath();
  if (loaderPath) {
    const { register } = await import("node:module");
    const loaderUrl = pathToFileURL(loaderPath).href;
    register(loaderUrl, pathToFileURL(getThisDir() + path.sep).href);
    anyRegistered = true;
  }

  return anyRegistered;
}

/**
 * Build a child-process env that adds both the CJS preload (`-r ...`) and the
 * ESM registration (`--import=...`) to NODE_OPTIONS, preserving any value
 * the user already set.
 *
 * Both are needed because tsx loads user TypeScript as CJS by default (goes
 * through `Module._resolveFilename` — covered by `-r`) while some modules are
 * imported via ESM (covered by `--import=...`).
 *
 * If either shim file can't be found on disk, we degrade gracefully — the
 * dev loop still starts, we just don't shim that half.
 */
export function withNextShimsEnv(
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const additions: string[] = [];

  const cjsPath = getShimCjsPreloadPath();
  if (cjsPath) additions.push(`-r ${quoteNodeOption(cjsPath)}`);

  const registerPath = getShimRegisterPath();
  if (registerPath)
    additions.push(`--import=${pathToFileURL(registerPath).href}`);

  if (additions.length === 0) return baseEnv;

  const existing = baseEnv.NODE_OPTIONS ?? "";
  const prepended = additions.join(" ");
  return {
    ...baseEnv,
    NODE_OPTIONS: existing ? `${prepended} ${existing}` : prepended,
  };
}

/**
 * Quote a path for use inside NODE_OPTIONS. Paths containing spaces need
 * surrounding double quotes; Node's NODE_OPTIONS parser understands them.
 * This is a minimal implementation — we never see quotes in resolved shim
 * paths, so escaping inner quotes isn't worth the complexity.
 */
function quoteNodeOption(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
