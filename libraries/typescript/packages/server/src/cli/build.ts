/**
 * `mcp-use build` — Vite SSR/node build of the user's server entry into the
 * `.mcp-use/build/` workspace directory (CLI_SPEC.md § Commands → build).
 *
 * `vite` is an optional peer dependency of `@mcp-use/server` (never a regular
 * dependency): this module is only ever reached through the bin's dynamic
 * `import("./cli/index.js")`, so a missing install surfaces as a rejected
 * promise there (classified by `bin/main.ts`'s `isViteMissing`), not at
 * package load time.
 */

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { build } from "vite";

import { discoverEntry } from "./entry.js";
import {
  resolveWorkspacePaths,
  type BuildManifest,
} from "./workspace.js";

/** Fixed filename of the emitted server entry inside `.mcp-use/build/`. */
const BUILD_ENTRY_NAME = "index.js";

/**
 * Options for {@link runBuild}.
 *
 * @internal
 */
export interface BuildOptions {
  /** Absolute path to the project root (the directory containing the entry). */
  cwd: string;
  /**
   * Explicit entry path (the `--entry` flag), absolute or relative to `cwd`.
   *
   * @defaultValue Conventional discovery: `src/index.ts`, `src/server.ts`,
   * `index.ts`, `server.ts` — first hit wins.
   */
  entry?: string;
}

/**
 * Build the project's server for production: a Vite build of the SSR/node
 * environment only (no client environment exists in this phase), emitted as
 * ESM to `.mcp-use/build/` with a `manifest.json` alongside it.
 *
 * Dependencies stay external (`packages: "external"` semantics): only the
 * user's own source is bundled; every bare import resolves from
 * `node_modules` at runtime. The built entry preserves the default export
 * (the `MCPServer` instance) so `mcp-use start` can import and serve it.
 *
 * There is deliberately no typecheck step — the build is transpile-only;
 * users run `tsc --noEmit` via their own script.
 *
 * @param options - Project root and optional entry override.
 * @throws If no entry is found (see {@link discoverEntry}), or if `vite` is
 * not installed (`mcp-use build` requires it as a devDependency) — the
 * `import("vite")` rejection propagates to the bin's dispatch boundary,
 * which classifies it and prints the install hint.
 *
 * @internal Reached only via the bin's `import("./cli/index.js")`
 * dispatch (`bin/main.ts`) — not re-exported from the package's "." entry.
 */
export async function runBuild(options: BuildOptions): Promise<void> {
  const startedAt = performance.now();
  const entry = discoverEntry(options.cwd, options.entry);
  const paths = resolveWorkspacePaths(options.cwd);

  await build({
    root: options.cwd,
    configFile: false,
    envFile: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    build: {
      // SSR/node build of the entry only — no client environment.
      ssr: entry,
      outDir: paths.build,
      emptyOutDir: true,
      target: "node24",
      sourcemap: true,
      minify: false,
      rollupOptions: {
        output: {
          format: "es",
          entryFileNames: BUILD_ENTRY_NAME,
        },
      },
    },
    ssr: {
      // Externalize ALL bare imports (including linked workspace packages):
      // the user's source is bundled, node_modules resolve at runtime.
      external: true,
      target: "node",
    },
  });

  const manifest: BuildManifest = {
    buildId: randomBytes(8).toString("hex"),
    entryPoint: BUILD_ENTRY_NAME,
    createdAt: new Date().toISOString(),
    inspector: true,
  };
  await mkdir(paths.build, { recursive: true });
  await writeFile(
    paths.buildManifest,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const duration = Math.round(performance.now() - startedAt);
  console.log(
    `[mcp-use] built ${relative(options.cwd, entry)} → ` +
      `${relative(options.cwd, paths.build)}/${BUILD_ENTRY_NAME} (${duration}ms)`
  );
}
