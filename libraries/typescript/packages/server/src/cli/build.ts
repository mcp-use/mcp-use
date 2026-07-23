/**
 * `mcp-use build` — Vite SSR/node build of the user's server entry into the
 * `.mcp-use/build/` workspace directory (CLI_SPEC.md § Commands → build).
 *
 * When views exist (under `views/<name>/view.tsx`), also runs a client-environment
 * build per view (hashed assets on disk), validates bindings, and emits a
 * wrapper entry that primes views before re-exporting the server (VIEWS_SPEC.md §
 * Build system).
 *
 * Vite is regular framework implementation machinery, but this module is
 * reached only through the bin's lazy build command. Library imports and
 * `mcp-use start` therefore never evaluate Vite.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

import { discoverEntry } from "./entry.js";
import {
  loadProjectEnv,
  nextStandaloneAliases,
  nextStandaloneCompatPlugin,
  nextStandaloneSsrOptions,
} from "./next-compat.js";
import { mcpUseViewsPlugin } from "./views-plugin.js";
import { syncMcpEnvDeclaration } from "./mcp-env-declaration.js";
import {
  resolveBuildBasePath,
  validateViewBindingsAtBuild,
} from "./views-bindings.js";
import {
  createBindingValidationServer,
  discoverViews,
  virtualViewId,
  type DiscoveredView,
} from "./views.js";
import { resolveTailwindCss, resolveUserViteConfig } from "./vite-config.js";
import { resolveWorkspacePaths, type BuildManifest } from "./workspace.js";
import { normalizeAssetsBaseUrl } from "../views/origin.js";
import { viewAssetsBasePath } from "../views/document.js";
import type { ViewsManifest } from "../views/types.js";

/** Fixed filename of the emitted server entry inside `.mcp-use/build/`. */
const BUILD_ENTRY_NAME = "index.js";

const WRAPPER_BASENAME = "entry-wrapper.ts";

/** Inline imported assets as data URLs up to this byte size (effectively all). */
const ASSETS_INLINE_LIMIT = 100 * 1024 * 1024;

async function copyPublicAssets(cwd: string, outputDir: string): Promise<void> {
  const publicSrc = join(cwd, "public");
  if (existsSync(publicSrc)) {
    await cp(publicSrc, outputDir, { recursive: true });
  }
}

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
  /** Directory containing the conventional entry and, by default, views/. */
  mcpDir?: string;
  /** Explicit views directory, absolute or relative to `cwd`. */
  viewsDir?: string;
  /** Emit source maps for the server and view bundles. */
  sourceMaps?: boolean;
  /**
   * Embed each production view's JavaScript and CSS in its MCP resource.
   *
   * @defaultValue `false`; views use external hashed assets.
   */
  inline?: boolean;
}

/**
 * Emit a short-lived wrapper module under `.mcp-use/cache/` that primes views
 * before re-exporting the user's entry (VIEWS_SPEC.md § Registration mechanism).
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
      `import { registerViews } from "mcp-use";`,
      `server[registerViews](${manifestJson});`,
      `export default server;`,
      "",
    ].join("\n")
  );
  return wrapperPath;
}

function readBuildAssetsBase(): string | undefined {
  const raw = process.env["MCP_ASSETS_URL"];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  try {
    return normalizeAssetsBaseUrl(new URL(raw).href.replace(/\/$/, ""));
  } catch {
    return undefined;
  }
}

/** Rewrite a view-relative manifest path to a full CDN URL at build time. */
function toCdnAssetUrl(
  relativePath: string,
  viewName: string,
  assetsBase: string,
  basePath: string
): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `${assetsBase}${viewAssetsBasePath(basePath, viewName)}${clean}`;
}

function applyBuildAssetsPrefix(
  entry: ViewsManifest[string],
  viewName: string,
  assetsBase: string,
  basePath: string
): ViewsManifest[string] {
  if (entry.kind !== "external") {
    return entry;
  }
  return {
    ...entry,
    entry: toCdnAssetUrl(entry.entry, viewName, assetsBase, basePath),
    css: entry.css.map((path) =>
      toCdnAssetUrl(path, viewName, assetsBase, basePath)
    ),
    ...(entry.scripts !== undefined && {
      scripts: entry.scripts.map((path) =>
        toCdnAssetUrl(path, viewName, assetsBase, basePath)
      ),
    }),
  };
}

/**
 * Build one view into either embedded source or hashed assets on disk.
 */
async function buildView(
  view: DiscoveredView,
  options: {
    cwd: string;
    cacheDir: string;
    viewsOutDir: string;
    userViteConfig: string | false;
    sourceMaps: boolean;
    inline: boolean;
  }
): Promise<ViewsManifest[string]> {
  const viewOutDir = join(options.viewsOutDir, view.name);
  const clientResult = await build({
    root: options.cwd,
    configFile: options.userViteConfig,
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    cacheDir: options.cacheDir,
    define: {
      __MCP_USE_VIEW_USAGE_DISABLED__: JSON.stringify(
        process.env.MCP_USE_ANONYMIZED_TELEMETRY === "false"
      ),
    },
    resolve: {
      tsconfigPaths: true,
      alias: { tailwindcss: resolveTailwindCss() },
    },
    plugins: [
      tailwindcss(),
      react(),
      mcpUseViewsPlugin({ getViews: () => [view] }),
    ],
    build: {
      outDir: viewOutDir,
      emptyOutDir: true,
      write: !options.inline,
      target: "es2022",
      sourcemap: options.inline ? false : options.sourceMaps,
      minify: true,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 1000,
      assetsInlineLimit: ASSETS_INLINE_LIMIT,
      rollupOptions: {
        input: { [view.name]: virtualViewId(view.name) },
        output: {
          format: "es",
          codeSplitting: !options.inline,
          entryFileNames: "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
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
  let inlineJs: string | undefined;
  const inlineCss: string[] = [];

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
      code?: string;
      source?: string | Uint8Array;
    };
    if (typed.type === "chunk" && typed.isEntry === true) {
      jsFileName = typed.fileName;
      inlineJs = typed.code;
    } else if (typed.type === "asset" && typed.fileName.endsWith(".css")) {
      cssFileName = typed.fileName;
      if (typeof typed.source === "string") {
        inlineCss.push(typed.source);
      } else if (typed.source instanceof Uint8Array) {
        inlineCss.push(new TextDecoder().decode(typed.source));
      }
    }
  }

  if (jsFileName === undefined) {
    throw new Error(
      `Client build produced no entry chunk for view "${view.name}".`
    );
  }

  if (options.inline) {
    if (inlineJs === undefined) {
      throw new Error(
        `Client build produced no entry source for view "${view.name}".`
      );
    }
    return {
      kind: "inline",
      js: inlineJs,
      css: inlineCss.join("\n"),
    };
  }

  return {
    kind: "external",
    entry: jsFileName.replace(/^\/+/, ""),
    css: cssFileName !== undefined ? [cssFileName.replace(/^\/+/, "")] : [],
  };
}

/**
 * Build the project for production: a Vite SSR/node server bundle plus one
 * external client build per discovered view, emitted to `.mcp-use/build/`
 * with a start manifest alongside it.
 *
 * Dependencies stay external (`ssr: { external: true }`): only the
 * user's own source is bundled; every bare import resolves from
 * `node_modules` at runtime. The built entry preserves the default export
 * (the `MCPServer` instance) so `mcp-use start` can import and serve it.
 *
 * There is deliberately no typecheck step — the build is transpile-only;
 * users run `mcp-use typecheck` via their own script.
 *
 * @param options - Project root and optional entry override.
 * @throws If no entry is found (see {@link discoverEntry}) or a server/view
 * build or binding validation step fails.
 *
 * @internal Reached only via the bin's `import("./cli/index.js")`
 * dispatch (`bin/main.ts`) — not re-exported from the package's "." entry.
 */
export async function runBuild(options: BuildOptions): Promise<void> {
  const startedAt = performance.now();
  loadProjectEnv(options.cwd, "production");
  const sourceRoot =
    options.mcpDir === undefined
      ? options.cwd
      : resolve(options.cwd, options.mcpDir);
  const entry =
    options.entry === undefined
      ? discoverEntry(sourceRoot)
      : discoverEntry(options.cwd, options.entry);
  const declarationStatus = await syncMcpEnvDeclaration(options.cwd, entry);
  if (declarationStatus === "created" || declarationStatus === "updated") {
    console.log(`[mcp-use] ${declarationStatus} mcp-env.d.ts`);
  }
  const paths = resolveWorkspacePaths(options.cwd);
  const viewsDirectory =
    options.viewsDir ??
    (options.mcpDir === undefined ? undefined : join(options.mcpDir, "views"));
  const views = discoverViews(options.cwd, viewsDirectory);
  const userViteConfig = resolveUserViteConfig(options.cwd);
  const sourceMaps = options.sourceMaps === true;
  const inline = options.inline === true;

  if (views.length === 0) {
    await build({
      root: options.cwd,
      configFile: false,
      envDir: false,
      publicDir: false,
      logLevel: "warn",
      cacheDir: paths.cache,
      resolve: {
        tsconfigPaths: true,
        alias: nextStandaloneAliases(options.cwd),
      },
      plugins: [nextStandaloneCompatPlugin(options.cwd)],
      build: {
        ssr: entry,
        outDir: paths.build,
        emptyOutDir: true,
        target: "node22",
        sourcemap: sourceMaps,
        minify: false,
        rollupOptions: {
          output: {
            format: "es",
            entryFileNames: BUILD_ENTRY_NAME,
          },
        },
      },
      ssr: {
        ...nextStandaloneSsrOptions(options.cwd),
        target: "node",
      },
    });

    // Branding may reference project-public icon files even when the server
    // has no views. Keep the runtime public-asset location identical in both
    // shapes so `mcp-use start` and serverless built entries behave alike.
    await copyPublicAssets(options.cwd, join(paths.build, "views/public"));

    const manifest: BuildManifest = {
      buildId: randomBytes(8).toString("hex"),
      entryPoint: BUILD_ENTRY_NAME,
      createdAt: new Date().toISOString(),
      views: {},
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

  await rm(paths.build, { recursive: true, force: true });

  const viewsOutDir = join(paths.build, "views");
  await mkdir(viewsOutDir, { recursive: true });

  const bindingServer = await createBindingValidationServer(
    options.cwd,
    paths.cache,
    false
  );
  let buildBasePath: string;
  const viewsManifest: ViewsManifest = {};
  const buildAssetsBase = readBuildAssetsBase();
  try {
    buildBasePath = await resolveBuildBasePath(
      bindingServer.environments.ssr,
      entry
    );

    for (const view of views) {
      let manifestEntry = await buildView(view, {
        cwd: options.cwd,
        cacheDir: paths.cache,
        viewsOutDir,
        userViteConfig,
        sourceMaps,
        inline,
      });
      if (buildAssetsBase !== undefined && !inline) {
        manifestEntry = applyBuildAssetsPrefix(
          manifestEntry,
          view.name,
          buildAssetsBase,
          buildBasePath
        );
      }
      viewsManifest[view.name] = manifestEntry;
    }

    if (buildAssetsBase !== undefined && !inline) {
      console.log(
        `[mcp-use] MCP_ASSETS_URL set — manifest uses CDN URLs; upload ` +
          `${relative(options.cwd, viewsOutDir)}/ to your asset host.`
      );
      if (buildBasePath !== "/mcp") {
        console.log(
          `[mcp-use] CDN manifest uses basePath ${buildBasePath} from server entry`
        );
      }
    }

    await copyPublicAssets(options.cwd, join(viewsOutDir, "public"));

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
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    cacheDir: paths.cache,
    resolve: {
      tsconfigPaths: true,
      alias: nextStandaloneAliases(options.cwd),
    },
    plugins: [nextStandaloneCompatPlugin(options.cwd)],
    build: {
      ssr: wrapperEntry,
      outDir: paths.build,
      emptyOutDir: false,
      target: "node22",
      sourcemap: sourceMaps,
      minify: false,
      rollupOptions: {
        output: {
          format: "es",
          entryFileNames: BUILD_ENTRY_NAME,
        },
      },
    },
    ssr: {
      ...nextStandaloneSsrOptions(options.cwd),
      target: "node",
    },
  });

  const manifest: BuildManifest = {
    buildId: randomBytes(8).toString("hex"),
    entryPoint: BUILD_ENTRY_NAME,
    createdAt: new Date().toISOString(),
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
