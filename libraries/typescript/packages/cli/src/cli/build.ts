/**
 * `mcp-use build` — Vite SSR/node build of the user's server entry into the
 * `.mcp-use/build/` workspace directory.
 *
 * When views exist (under `views/<name>/view.tsx`), also runs a client-environment
 * build per view (hashed assets on disk), validates bindings, and emits a
 * wrapper entry that primes views before re-exporting the server. A
 * `<mcp-root>/landing.tsx` gets the same client build into
 * `.mcp-use/build/landing/` and is primed by the same wrapper.
 *
 * Vite is regular framework implementation machinery, but this module is
 * reached only through the bin's lazy build command. Library imports and
 * `mcp-use start` therefore never evaluate Vite.
 */

import { readViewConfig } from "./view-config.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";

import { discoverEntry } from "./entry.js";
import { mcpUseLandingPlugin, VIRTUAL_LANDING_ID } from "./landing-client.js";
import {
  createLandingDataKeysCollector,
  type LandingDataKey,
} from "./landing-data-keys.js";
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
  resolveViewsDir,
  virtualViewId,
  type DiscoveredView,
} from "./views.js";
import { resolveTailwindCss, resolveUserViteConfig } from "./vite-config.js";
import { resolveWorkspacePaths, type BuildManifest } from "./workspace.js";
import { normalizeAssetsBaseUrl } from "../views/origin.js";
import {
  landingAssetsBasePath,
  viewAssetsBasePath,
} from "../views/document.js";
import type { ViewsManifest } from "../views/types.js";
import type { SkillsSnapshot } from "../skills/types.js";

/** Fixed filename of the emitted server entry inside `.mcp-use/build/`. */
const BUILD_ENTRY_NAME = "index.js";

const WRAPPER_BASENAME = "entry-wrapper.ts";

/** Landing hydration bundle directory inside `.mcp-use/build/`. */
const LANDING_OUT_DIR = "landing";

/** Inline imported assets as data URLs up to this byte size (effectively all). */
const ASSETS_INLINE_LIMIT = 100 * 1024 * 1024;

interface BuiltLanding {
  source: string;
  entry: string;
  css: string[];
  /** Lists the page's modules import a hook for, sorted. */
  dataKeys: LandingDataKey[];
}

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
  /** Discover the project's Vite config for views. Defaults to `true`. */
  viewsConfig?: boolean;
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
 * before re-exporting the user's entry.
 */
async function writeWrapperEntry(
  cacheDir: string,
  userEntry: string,
  viewsManifest: ViewsManifest,
  skillsSnapshot: SkillsSnapshot | undefined,
  landing?: BuiltLanding
): Promise<string> {
  const wrapperPath = join(cacheDir, WRAPPER_BASENAME);
  await mkdir(cacheDir, { recursive: true });
  const manifestJson = JSON.stringify(viewsManifest);
  const skillsJson = JSON.stringify(skillsSnapshot);
  await writeFile(
    wrapperPath,
    [
      `import server from ${JSON.stringify(userEntry)};`,
      `import { registerSkills, registerViews } from "mcp-use";`,
      ...(landing === undefined
        ? []
        : [
            `import * as LandingModule from ${JSON.stringify(landing.source)};`,
            `import { createElement } from "react";`,
            `import { renderToString } from "react-dom/server";`,
            `import { __withLandingData } from "mcp-use/landing";`,
            `import { fileURLToPath } from "node:url";`,
          ]),
      `server[registerViews](${manifestJson});`,
      `server[registerSkills](${skillsJson});`,
      ...(landing === undefined
        ? []
        : [
            `server.__primeLandingPage({`,
            `  render: (data) => __withLandingData(data, () => renderToString(createElement(LandingModule.default))),`,
            // Optional export: a static `LandingModule.metadata` would make
            // the bundler warn about every page that does not export it.
            `  metadata: Reflect.get(LandingModule, "metadata"),`,
            `  entry: ${JSON.stringify(landing.entry)},`,
            `  css: ${JSON.stringify(landing.css)},`,
            `  dataKeys: ${JSON.stringify(landing.dataKeys)},`,
            `  projectRoot: fileURLToPath(new URL("../../", import.meta.url)),`,
            `});`,
          ]),
      `export default server;`,
      "",
    ].join("\n")
  );
  return wrapperPath;
}

/** Stylesheet languages Vite compiles, as module paths without a query. */
const STYLESHEET_PATH =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;

/**
 * The wrapper imports `landing.tsx` to render it, so the page's stylesheets
 * reach the server bundle, which never ships CSS. Load them empty rather than
 * compile them without the client build's Tailwind setup, where
 * `@import "tailwindcss"` cannot resolve. CSS modules still compile: rendering
 * reads their class names.
 */
function serverStylesheetStubPlugin(): Plugin {
  return {
    name: "mcp-use-server-stylesheet-stub",
    enforce: "pre",
    load(id) {
      if (!STYLESHEET_PATH.test(id) || /\.module\.\w+$/.test(id)) {
        return undefined;
      }
      return "";
    },
  };
}

/** Entry chunk and stylesheets emitted by one {@link buildClientBundle} run. */
interface ClientBundle {
  /** Entry chunk path relative to the output directory. */
  entry: string;
  /** Stylesheet paths relative to the output directory. */
  css: string[];
  /** Entry chunk source, for bundles embedded instead of written. */
  js: string | undefined;
  /** Stylesheet sources, for bundles embedded instead of written. */
  cssSources: string[];
}

/**
 * Run the browser build shared by views and the landing page: the project's
 * Vite config plus Tailwind and React, one virtual entry resolved by
 * `plugin`, hashed assets, and a single stylesheet.
 */
async function buildClientBundle(options: {
  cwd: string;
  cacheDir: string;
  outDir: string;
  userViteConfig: string | false;
  sourceMaps: boolean;
  /** Keep the output in memory as one chunk instead of writing files. */
  inline: boolean;
  /** Resolve the virtual entry named by `input`, plus bundle-specific hooks. */
  plugins: Plugin[];
  /** Rollup input map: output chunk name to virtual entry id. */
  input: Record<string, string>;
  /** Names the bundle in build errors, e.g. `view "weather"`. */
  label: string;
}): Promise<ClientBundle> {
  const clientResult = await build({
    root: options.cwd,
    configFile: options.userViteConfig,
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    cacheDir: options.cacheDir,
    resolve: {
      tsconfigPaths: true,
      alias: { tailwindcss: resolveTailwindCss() },
    },
    oxc: { jsx: { runtime: "automatic" } },
    plugins: [tailwindcss(), react(), ...options.plugins],
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      write: !options.inline,
      target: "es2022",
      sourcemap: options.inline ? false : options.sourceMaps,
      minify: true,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 1000,
      assetsInlineLimit: ASSETS_INLINE_LIMIT,
      rollupOptions: {
        input: options.input,
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
    throw new Error(`Client build for ${options.label} produced no output.`);
  }

  const rawOutput = clientOutput.output;
  const items = Array.isArray(rawOutput) ? rawOutput : Object.values(rawOutput);

  let entry: string | undefined;
  let js: string | undefined;
  const css: string[] = [];
  const cssSources: string[] = [];

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
      entry = typed.fileName.replace(/^\/+/, "");
      js = typed.code;
    } else if (typed.type === "asset" && typed.fileName.endsWith(".css")) {
      css.push(typed.fileName.replace(/^\/+/, ""));
      if (typeof typed.source === "string") {
        cssSources.push(typed.source);
      } else if (typed.source instanceof Uint8Array) {
        cssSources.push(new TextDecoder().decode(typed.source));
      }
    }
  }

  if (entry === undefined) {
    throw new Error(
      `Client build produced no entry chunk for ${options.label}.`
    );
  }
  return { entry, css, js, cssSources };
}

/** Compile the discovered component and its imported styles for hydration. */
async function buildLanding(
  source: string,
  options: {
    cwd: string;
    cacheDir: string;
    buildDir: string;
    userViteConfig: string | false;
    sourceMaps: boolean;
  }
): Promise<BuiltLanding> {
  const dataKeys = createLandingDataKeysCollector({ environment: "client" });
  const bundle = await buildClientBundle({
    cwd: options.cwd,
    cacheDir: options.cacheDir,
    outDir: join(options.buildDir, LANDING_OUT_DIR),
    userViteConfig: options.userViteConfig,
    sourceMaps: options.sourceMaps,
    inline: false,
    plugins: [
      mcpUseLandingPlugin({ getLandingPath: () => source }),
      dataKeys.plugin,
    ],
    input: { landing: VIRTUAL_LANDING_ID },
    label: "the landing page",
  });
  return {
    source,
    entry: bundle.entry,
    css: bundle.css,
    dataKeys: dataKeys.all(),
  };
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

/** Rewrite a bundle-relative path to a full CDN URL at build time. */
function toCdnAssetUrl(
  relativePath: string,
  routePath: string,
  assetsBase: string
): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `${assetsBase}${routePath}${clean}`;
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
  const routePath = viewAssetsBasePath(basePath, viewName);
  return {
    ...entry,
    entry: toCdnAssetUrl(entry.entry, routePath, assetsBase),
    css: entry.css.map((path) => toCdnAssetUrl(path, routePath, assetsBase)),
    ...(entry.scripts !== undefined && {
      scripts: entry.scripts.map((path) =>
        toCdnAssetUrl(path, routePath, assetsBase)
      ),
    }),
  };
}

/** Point the landing hydration entry and stylesheets at the build-time CDN. */
function applyLandingAssetsPrefix(
  landing: BuiltLanding,
  assetsBase: string,
  basePath: string
): BuiltLanding {
  const routePath = landingAssetsBasePath(basePath);
  return {
    ...landing,
    entry: toCdnAssetUrl(landing.entry, routePath, assetsBase),
    css: landing.css.map((path) => toCdnAssetUrl(path, routePath, assetsBase)),
  };
}

/**
 * Tell the user which generated directory a CDN build expects at a URL. The
 * path uses forward slashes on every platform, like the URL beside it.
 */
function logCdnPublishLocation(
  cwd: string,
  outDir: string,
  assetUrl: string
): void {
  console.log(
    `[mcp-use] MCP_ASSETS_URL set — publish ` +
      `${relative(cwd, outDir).replaceAll("\\", "/")}/ at ${assetUrl}`
  );
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
  const bundle = await buildClientBundle({
    cwd: options.cwd,
    cacheDir: options.cacheDir,
    outDir: join(options.viewsOutDir, view.name),
    userViteConfig: options.userViteConfig,
    sourceMaps: options.sourceMaps,
    inline: options.inline,
    plugins: [mcpUseViewsPlugin({ getViews: () => [view] })],
    input: { [view.name]: virtualViewId(view.name) },
    label: `view "${view.name}"`,
  });

  if (options.inline) {
    if (bundle.js === undefined) {
      throw new Error(
        `Client build produced no entry source for view "${view.name}".`
      );
    }
    return {
      kind: "inline",
      viewConfig: readViewConfig(view.entryPath),
      js: bundle.js,
      css: bundle.cssSources.join("\n"),
    };
  }

  return {
    kind: "external",
    viewConfig: readViewConfig(view.entryPath),
    entry: bundle.entry,
    css: bundle.css,
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
  // Vite's dev server, which evaluates the entry below, sets NODE_ENV to
  // development when it is unset, and every later build in this process
  // would then bundle React's development build: views would ship it, and
  // server JSX would call `jsxDEV`, which production React leaves undefined.
  // Set it before the project `.env` loads, as `mcp-use start` does, so a
  // `.env` that sets NODE_ENV=development cannot undo it. An explicit shell
  // NODE_ENV still wins.
  process.env["NODE_ENV"] ??= "production";
  loadProjectEnv(options.cwd, "production");
  const sourceRoot =
    options.mcpDir === undefined
      ? options.cwd
      : resolve(options.cwd, options.mcpDir);
  const landingSource = join(sourceRoot, "landing.tsx");
  const hasLanding = existsSync(landingSource);
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
  if (!existsSync(resolveViewsDir(options.cwd, viewsDirectory))) {
    console.log("[mcp-use] views directory not configured.");
  }
  const views = discoverViews(options.cwd, viewsDirectory);
  const userViteConfig =
    options.viewsConfig === false ? false : resolveUserViteConfig(options.cwd);
  const sourceMaps = options.sourceMaps === true;
  const inline = options.inline === true;
  let bindingServer:
    | Awaited<ReturnType<typeof createBindingValidationServer>>
    | undefined;
  const conventionalSkillsDirectory =
    options.mcpDir === undefined ? "skills" : join(options.mcpDir, "skills");

  if (views.length === 0) {
    let skillsSnapshot: SkillsSnapshot | undefined;
    bindingServer ??= await createBindingValidationServer(
      options.cwd,
      paths.cache,
      false
    );
    try {
      skillsSnapshot = await validateViewBindingsAtBuild(
        bindingServer.environments.ssr,
        entry,
        {},
        options.cwd,
        conventionalSkillsDirectory
      );
      let landing: BuiltLanding | undefined;
      if (hasLanding) {
        await rm(paths.build, { recursive: true, force: true });
        landing = await buildLanding(landingSource, {
          cwd: options.cwd,
          cacheDir: paths.cache,
          buildDir: paths.build,
          userViteConfig,
          sourceMaps,
        });
        const buildAssetsBase = readBuildAssetsBase();
        if (buildAssetsBase !== undefined) {
          const buildBasePath = await resolveBuildBasePath(
            bindingServer.environments.ssr,
            entry
          );
          landing = applyLandingAssetsPrefix(
            landing,
            buildAssetsBase,
            buildBasePath
          );
          logCdnPublishLocation(
            options.cwd,
            join(paths.build, LANDING_OUT_DIR),
            `${buildAssetsBase}${landingAssetsBasePath(buildBasePath)}`
          );
          if (buildBasePath !== "/mcp") {
            console.log(
              `[mcp-use] CDN manifest uses basePath ${buildBasePath} from server entry`
            );
          }
        }
      }
      const wrapperEntry = await writeWrapperEntry(
        paths.cache,
        entry,
        {},
        skillsSnapshot,
        landing
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
        plugins: [
          nextStandaloneCompatPlugin(options.cwd),
          serverStylesheetStubPlugin(),
        ],
        build: {
          ssr: wrapperEntry,
          outDir: paths.build,
          emptyOutDir: !hasLanding,
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
    } finally {
      await bindingServer?.close();
    }

    // Branding may reference project-public icon files even when the server
    // has no views. Keep the runtime public-asset location identical in both
    // shapes so `mcp-use start` and serverless built entries behave alike.
    await copyPublicAssets(options.cwd, join(paths.build, "views/public"));

    const manifest: BuildManifest = {
      buildId: randomBytes(8).toString("hex"),
      entryPoint: BUILD_ENTRY_NAME,
      createdAt: new Date().toISOString(),
      views: {},
      ...(skillsSnapshot !== undefined && { skills: skillsSnapshot }),
    };
    await mkdir(paths.build, { recursive: true });
    await writeFile(
      paths.buildManifest,
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    const duration = Math.round(performance.now() - startedAt);
    console.log(
      `[mcp-use] built ${relative(options.cwd, entry)} → ` +
        `${relative(options.cwd, join(paths.build, BUILD_ENTRY_NAME))} (${duration}ms)`
    );
    return;
  }

  await rm(paths.build, { recursive: true, force: true });

  const viewsOutDir = join(paths.build, "views");
  await mkdir(viewsOutDir, { recursive: true });

  bindingServer ??= await createBindingValidationServer(
    options.cwd,
    paths.cache,
    false
  );
  let buildBasePath: string;
  const viewsManifest: ViewsManifest = {};
  let skillsSnapshot: SkillsSnapshot | undefined;
  const buildAssetsBase = readBuildAssetsBase();
  let landing: BuiltLanding | undefined;
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

    if (hasLanding) {
      landing = await buildLanding(landingSource, {
        cwd: options.cwd,
        cacheDir: paths.cache,
        buildDir: paths.build,
        userViteConfig,
        sourceMaps,
      });
      // Unlike views, the landing bundle is never embedded, so `--inline`
      // does not keep it off the CDN.
      if (buildAssetsBase !== undefined) {
        landing = applyLandingAssetsPrefix(
          landing,
          buildAssetsBase,
          buildBasePath
        );
      }
    }

    if (buildAssetsBase !== undefined && (!inline || landing !== undefined)) {
      if (!inline) {
        logCdnPublishLocation(
          options.cwd,
          viewsOutDir,
          `${buildAssetsBase}${viewAssetsBasePath(buildBasePath, "<view-name>")}`
        );
      }
      if (landing !== undefined) {
        logCdnPublishLocation(
          options.cwd,
          join(paths.build, LANDING_OUT_DIR),
          `${buildAssetsBase}${landingAssetsBasePath(buildBasePath)}`
        );
      }
      if (buildBasePath !== "/mcp") {
        console.log(
          `[mcp-use] CDN manifest uses basePath ${buildBasePath} from server entry`
        );
      }
    }

    await copyPublicAssets(options.cwd, join(viewsOutDir, "public"));

    skillsSnapshot = await validateViewBindingsAtBuild(
      bindingServer.environments.ssr,
      entry,
      viewsManifest,
      options.cwd,
      conventionalSkillsDirectory
    );
  } finally {
    await bindingServer.close();
  }

  const wrapperEntry = await writeWrapperEntry(
    paths.cache,
    entry,
    viewsManifest,
    skillsSnapshot,
    landing
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
    oxc: { jsx: { runtime: "automatic" } },
    plugins: [
      nextStandaloneCompatPlugin(options.cwd),
      serverStylesheetStubPlugin(),
    ],
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
    ...(skillsSnapshot !== undefined && { skills: skillsSnapshot }),
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
      `${relative(options.cwd, join(paths.build, BUILD_ENTRY_NAME))} (${duration}ms)`
  );
}
