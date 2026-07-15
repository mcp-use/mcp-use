/**
 * `mcp-use build` — Vite SSR/node build of the user's server entry into the
 * `.mcp-use/build/` workspace directory (CLI_SPEC.md § Commands → build).
 *
 * When views exist (under `resources/<name>/view.tsx`), also runs a client-environment
 * build per view (self-contained inline bundles), validates bindings, and emits a
 * wrapper entry that primes views before re-exporting the server (VIEWS_SPEC.md §
 * Build system).
 *
 * `vite` is an optional peer dependency of `@mcp-use/server` (never a regular
 * dependency): this module is only ever reached through the bin's dynamic
 * `import("./cli/index.js")`, so a missing install surfaces as a rejected
 * promise there (classified by `bin/main.ts`'s `isViteMissing`), not at
 * package load time.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { build } from "vite";

import { discoverEntry } from "./entry.js";
import { mcpUseViewsPlugin } from "./views-plugin.js";
import { validateViewBindingsAtBuild } from "./views-bindings.js";
import {
  createBindingValidationServer,
  discoverViews,
  virtualViewId,
  type DiscoveredView,
} from "./views.js";
import { resolveWorkspacePaths, type BuildManifest } from "./workspace.js";
import { resolveUserViteConfig } from "./vite-config.js";
import type { ViewsManifest } from "../views/types.js";

/** Fixed filename of the emitted server entry inside `.mcp-use/build/`. */
const BUILD_ENTRY_NAME = "index.js";

const WRAPPER_BASENAME = "entry-wrapper.ts";

/** Inline imported assets as data URLs up to this byte size (effectively all). */
const ASSETS_INLINE_LIMIT = 100 * 1024 * 1024;

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
 * Emit a short-lived wrapper module under `.mcp-use/cache/` that primes views
 * before re-exporting the user's entry (VIEWS_SPEC.md § Registration mechanism).
 *
 * Production manifests carry full JS/CSS source strings; `JSON.stringify`
 * embeds them as escaped string literals in the generated module (large
 * payloads are accepted — matches the no-fs-on-MCP-path rule).
 */
async function writeWrapperEntry(
  cacheDir: string,
  userEntry: string,
  viewsManifest: ViewsManifest
): Promise<string> {
  const wrapperPath = join(cacheDir, WRAPPER_BASENAME);
  await mkdir(cacheDir, { recursive: true });
  const manifestJson = JSON.stringify(viewsManifest);
  await writeFile(
    wrapperPath,
    [
      `import server from ${JSON.stringify(userEntry)};`,
      `import { registerViews } from "@mcp-use/server";`,
      `server[registerViews](${manifestJson});`,
      `export default server;`,
      "",
    ].join("\n")
  );
  return wrapperPath;
}

/**
 * Build one view into a self-contained ES module + CSS, then read the emitted
 * text into an inline manifest entry.
 *
 * @param view - Discovered view to build.
 * @param options - Project paths and Vite config.
 * @param emptyOutDir - Whether to wipe the views output directory first.
 */
async function buildInlineView(
  view: DiscoveredView,
  options: {
    cwd: string;
    cacheDir: string;
    viewsOutDir: string;
    userViteConfig: string | false;
  }
): Promise<ViewsManifest[string]> {
  const viewOutDir = join(options.viewsOutDir, view.name);
  const clientResult = await build({
    root: options.cwd,
    configFile: options.userViteConfig,
    envFile: false,
    logLevel: "warn",
    cacheDir: options.cacheDir,
    plugins: [mcpUseViewsPlugin({ getViews: () => [view] })],
    build: {
      outDir: viewOutDir,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      minify: true,
      cssCodeSplit: false,
      assetsInlineLimit: ASSETS_INLINE_LIMIT,
      rollupOptions: {
        input: { [view.name]: virtualViewId(view.name) },
        output: {
          format: "es",
          // Rolldown: prefer codeSplitting:false over deprecated inlineDynamicImports.
          codeSplitting: false,
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
    base: "./",
  });

  const clientOutput = Array.isArray(clientResult)
    ? clientResult[0]
    : clientResult;
  if (clientOutput === undefined || !("output" in clientOutput)) {
    throw new Error(`Client build for view "${view.name}" produced no output.`);
  }

  const rawOutput = clientOutput.output;
  const items = Array.isArray(rawOutput) ? rawOutput : Object.values(rawOutput);

  let jsFileName: string | undefined;
  let cssFileName: string | undefined;

  for (const item of items) {
    if (typeof item !== "object" || item === null || !("fileName" in item)) {
      continue;
    }
    const fileName = (item as { fileName: unknown }).fileName;
    if (typeof fileName !== "string") {
      continue;
    }
    const typed = item as {
      type?: string;
      isEntry?: boolean;
      fileName: string;
    };
    if (typed.type === "chunk" && typed.isEntry === true) {
      jsFileName = typed.fileName;
    } else if (typed.type === "asset" && typed.fileName.endsWith(".css")) {
      cssFileName = typed.fileName;
    }
  }

  if (jsFileName === undefined) {
    throw new Error(
      `Client build produced no entry chunk for view "${view.name}".`
    );
  }

  const js = await readFile(join(viewOutDir, jsFileName), "utf8");
  const css =
    cssFileName !== undefined
      ? await readFile(join(viewOutDir, cssFileName), "utf8")
      : "";

  return { kind: "inline", js, css };
}

/**
 * Build the project's server for production: a Vite build of the SSR/node
 * environment only (the client environment for views arrives with
 * VIEWS_SPEC.md), emitted as ESM to `.mcp-use/build/` with a `manifest.json`
 * alongside it.
 *
 * Dependencies stay external (`ssr: { external: true }`): only the
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
  const views = discoverViews(options.cwd);
  const userViteConfig = resolveUserViteConfig(options.cwd);

  if (views.length === 0) {
    await build({
      root: options.cwd,
      configFile: false,
      envFile: false,
      logLevel: "warn",
      cacheDir: paths.cache,
      build: {
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
    return;
  }

  // Views build: wipe output, one self-contained client build per view, then SSR wrapper.
  await rm(paths.build, { recursive: true, force: true });

  const viewsOutDir = join(paths.build, "views");
  await mkdir(viewsOutDir, { recursive: true });

  const viewsManifest: ViewsManifest = {};
  for (const view of views) {
    viewsManifest[view.name] = await buildInlineView(view, {
      cwd: options.cwd,
      cacheDir: paths.cache,
      viewsOutDir,
      userViteConfig,
    });
  }

  const publicSrc = join(options.cwd, "public");
  if (existsSync(publicSrc)) {
    await cp(publicSrc, join(viewsOutDir, "public"), { recursive: true });
  }

  const bindingServer = await createBindingValidationServer(
    options.cwd,
    paths.cache,
    false
  );
  try {
    await validateViewBindingsAtBuild(
      bindingServer.environments.ssr,
      entry,
      viewsManifest
    );
  } finally {
    await bindingServer.close();
  }

  const wrapperEntry = await writeWrapperEntry(
    paths.cache,
    entry,
    viewsManifest
  );

  await build({
    root: options.cwd,
    configFile: false,
    envFile: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    build: {
      ssr: wrapperEntry,
      outDir: paths.build,
      emptyOutDir: false,
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
      external: true,
      target: "node",
    },
  });

  const manifest: BuildManifest = {
    buildId: randomBytes(8).toString("hex"),
    entryPoint: BUILD_ENTRY_NAME,
    createdAt: new Date().toISOString(),
    inspector: true,
    views: viewsManifest,
  };
  await mkdir(paths.build, { recursive: true });
  await writeFile(
    paths.buildManifest,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const duration = Math.round(performance.now() - startedAt);
  const viewNames = views.map((v) => v.name).join(", ");
  console.log(
    `[mcp-use] built ${relative(options.cwd, entry)} + views (${viewNames}) → ` +
      `${relative(options.cwd, paths.build)}/${BUILD_ENTRY_NAME} (${duration}ms)`
  );
}
