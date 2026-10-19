/** Browser and development SSR entries for a CLI-discovered `landing.tsx`. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  normalizePath,
  type DevEnvironment,
  type Plugin,
  type Rollup,
} from "vite";

import {
  isDependency,
  reachable,
  type GraphNode,
} from "./landing-data-keys.js";
import { TAILWIND_STYLESHEET, VIEW_REACT_DEDUPE } from "./views-plugin.js";

/** Stable virtual entry used by the production client build and dev server. */
export const VIRTUAL_LANDING_ID = "virtual:mcp-use/landing";
const RESOLVED_LANDING_ID = `\0${VIRTUAL_LANDING_ID}`;

/** URL Vite serves for the development hydration entry. */
export const DEV_LANDING_ENTRY = `/@id/__x00__${VIRTUAL_LANDING_ID}`;

/**
 * The landing page's CLI-managed Tailwind stylesheet. Separate from the views'
 * copy, which a dev server may serve at the same time, because a page that
 * imports Tailwind itself gets an empty one.
 */
const VIRTUAL_LANDING_TAILWIND_ID = "virtual:mcp-use/landing-tailwind.css";
const RESOLVED_LANDING_TAILWIND_ID = `\0${VIRTUAL_LANDING_TAILWIND_ID}`;

/**
 * URL Vite serves the managed Tailwind stylesheet at in development. The page
 * head links it so server-rendered markup is styled before the entry runs;
 * the entry's own import of it keeps receiving hot updates.
 */
export const DEV_LANDING_TAILWIND_CSS = `/@id/__x00__${VIRTUAL_LANDING_TAILWIND_ID}`;

/** Stylesheet languages Vite compiles, as module paths without a query. */
const STYLESHEET_PATH =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;
const TAILWIND_IMPORT = /@import\s+(?:url\(\s*)?["']tailwindcss["']/;
const RELATIVE_IMPORT = /@import\s+(?:url\(\s*)?["'](\.{1,2}\/[^"']+)["']/g;

/**
 * Whether a module id is a global stylesheet. A query such as `?inline` or
 * `?url` makes the import a string, not a stylesheet on the page.
 */
function isStylesheet(id: string): boolean {
  return !id.includes("?") && STYLESHEET_PATH.test(id);
}

/**
 * Whether `file`, or a stylesheet it imports by relative path, contains
 * `@import "tailwindcss"`.
 */
function importsTailwind(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  if (TAILWIND_IMPORT.test(source)) return true;
  for (const [, path] of source.matchAll(RELATIVE_IMPORT)) {
    if (
      path !== undefined &&
      importsTailwind(resolve(dirname(file), path), seen)
    ) {
      return true;
    }
  }
  return false;
}

/** Stylesheets `source` imports, through the build's module graph. */
async function builtStylesheets(
  context: Rollup.PluginContext,
  source: string
): Promise<string[]> {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = async (id: string): Promise<void> => {
    if (seen.has(id)) return;
    seen.add(id);
    if (isStylesheet(id)) {
      found.push(id);
      return;
    }
    if (id.startsWith("\0") || isDependency(id)) return;
    const info = await context.load({ id, resolveDependencies: true });
    await Promise.all(
      [...info.importedIds, ...info.dynamicallyImportedIds].map(visit)
    );
  };
  await visit(source);
  return found;
}

/**
 * Stylesheets `source` imports, through a dev server's module graph.
 * Modules not transformed yet, or edited since, are transformed first so
 * their imports are in the graph.
 */
async function devStylesheets(
  environment: DevEnvironment,
  source: string
): Promise<string[]> {
  const id = normalizePath(source);
  await environment.transformRequest(id);
  const root = environment.moduleGraph.getModuleById(id);
  const attempted = new Set<GraphNode>();
  for (;;) {
    const nodes = reachable(root);
    const stale = nodes.filter(
      (node) =>
        node.id !== null &&
        node.transformResult == null &&
        !isStylesheet(node.id) &&
        !isDependency(node.id) &&
        !attempted.has(node)
    );
    if (stale.length === 0) {
      return nodes.flatMap((node) =>
        node.id !== null && isStylesheet(node.id) ? [node.id] : []
      );
    }
    for (const node of stale) attempted.add(node);
    await Promise.all(
      stale.map((node) =>
        environment.transformRequest(node.url).catch(() => undefined)
      )
    );
  }
}

/**
 * URLs of the stylesheets in a dev module graph under `root`, for the page
 * head. The graph must be current, as after
 * `LandingDataKeysCollector.reachableFrom`.
 */
export function landingStylesheetUrls(root: GraphNode | undefined): string[] {
  return reachable(root).flatMap((node) =>
    node.id !== null && isStylesheet(node.id) ? [node.url] : []
  );
}

/**
 * Compile the user's landing component as a browser hydration entry. The
 * source path remains live so a file created after `mcp-use dev` starts can be
 * loaded without replacing Vite's client environment. Like views, the entry
 * loads the CLI-managed Tailwind stylesheet, preflight included, unless a
 * stylesheet the page imports brings its own `@import "tailwindcss"`.
 */
export function mcpUseLandingPlugin(options: {
  getLandingPath: () => string | undefined;
  dev?: boolean;
}): Plugin {
  return {
    name: "mcp-use-landing",
    config() {
      // One React copy for the component and the hydration entry, as views do.
      return { resolve: { dedupe: VIEW_REACT_DEDUPE } };
    },
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    hotUpdate({ file, modules }) {
      // A stylesheet edit can add or drop `@import "tailwindcss"`. Both the
      // entry's import and the dev head's `?direct` link are invalidated.
      if (!isStylesheet(file)) return undefined;
      const managed = this.environment.moduleGraph.getModulesByFile(
        RESOLVED_LANDING_TAILWIND_ID
      );
      if (managed === undefined || managed.size === 0) return undefined;
      for (const node of managed) {
        this.environment.moduleGraph.invalidateModule(node);
      }
      return [...modules, ...managed];
    },
    resolveId(id) {
      if (id === VIRTUAL_LANDING_ID) return RESOLVED_LANDING_ID;
      if (id === VIRTUAL_LANDING_TAILWIND_ID) {
        return RESOLVED_LANDING_TAILWIND_ID;
      }
      return undefined;
    },
    async load(id) {
      // The dev page head links it, so Vite asks for `?direct` CSS too.
      if (id.split("?", 1)[0] === RESOLVED_LANDING_TAILWIND_ID) {
        const source = options.getLandingPath();
        if (source === undefined) return TAILWIND_STYLESHEET;
        // Two compiled copies would each define the `dark` variant, so a
        // page that brings Tailwind owns it.
        const stylesheets =
          this.environment.mode === "dev"
            ? await devStylesheets(this.environment as DevEnvironment, source)
            : await builtStylesheets(this, source);
        return stylesheets.some(
          (file) => !isDependency(file) && importsTailwind(file)
        )
          ? ""
          : TAILWIND_STYLESHEET;
      }
      if (id !== RESOLVED_LANDING_ID) return undefined;
      const source = options.getLandingPath();
      if (source === undefined) return undefined;
      return [
        ...(options.dev === true
          ? ['import "@vitejs/plugin-react/preamble";']
          : []),
        // Before the page, so stylesheets it imports override the utilities.
        `import ${JSON.stringify(VIRTUAL_LANDING_TAILWIND_ID)};`,
        'import { createElement } from "react";',
        'import { hydrateRoot } from "react-dom/client";',
        'import { __setLandingData } from "mcp-use/landing";',
        `import Landing from ${JSON.stringify(source)};`,
        // The imports above inserted the same styles, and only theirs
        // receive hot updates.
        ...(options.dev === true
          ? [
              'for (const link of document.querySelectorAll("link[data-mcp-use-dev-css]")) link.remove();',
            ]
          : []),
        'const root = document.getElementById("mcp-use-landing-root");',
        'const dataNode = document.getElementById("mcp-use-landing-data");',
        "if (root && dataNode) {",
        '  __setLandingData(JSON.parse(dataNode.textContent || "{}"));',
        "  hydrateRoot(root, createElement(Landing));",
        "}",
        "",
      ].join("\n");
    },
  };
}

/** Development SSR module pairing `landing.tsx` with its data setter. */
export const VIRTUAL_LANDING_SSR_ID = "virtual:mcp-use/landing-ssr";
/** Module graph id of the SSR entry: the root of the page's import graph. */
export const RESOLVED_LANDING_SSR_ID = `\0${VIRTUAL_LANDING_SSR_ID}`;

/**
 * Serve `landing.tsx`, its `metadata` export (`undefined` when it has none),
 * and `__withLandingData` to the dev module runner. Importing
 * `mcp-use/landing` from inside the graph, as `landing.tsx` does, gives the
 * setter the module instance the hooks read: the runner
 * internalizes a bare specifier passed straight to `runner.import()`, which
 * would evaluate a second copy beside the externalized one.
 */
export function mcpUseLandingSsrPlugin(options: {
  getLandingPath: () => string | undefined;
}): Plugin {
  return {
    name: "mcp-use-landing-ssr",
    applyToEnvironment(environment) {
      return environment.name === "ssr";
    },
    resolveId(id) {
      return id === VIRTUAL_LANDING_SSR_ID
        ? RESOLVED_LANDING_SSR_ID
        : undefined;
    },
    load(id) {
      if (id !== RESOLVED_LANDING_SSR_ID) return undefined;
      const source = options.getLandingPath();
      if (source === undefined) return undefined;
      return [
        `import * as landing from ${JSON.stringify(source)};`,
        `export { default } from ${JSON.stringify(source)};`,
        // Read through the namespace, so a page without `metadata` loads.
        "export const metadata = landing.metadata;",
        'export { __withLandingData } from "mcp-use/landing";',
        "",
      ].join("\n");
    },
  };
}
