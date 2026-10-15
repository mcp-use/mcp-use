/** Browser and development SSR entries for a CLI-discovered `landing.tsx`. */

import type { Plugin } from "vite";

import { VIEW_REACT_DEDUPE } from "./views-plugin.js";

/** Stable virtual entry used by the production client build and dev server. */
export const VIRTUAL_LANDING_ID = "virtual:mcp-use/landing";
const RESOLVED_LANDING_ID = `\0${VIRTUAL_LANDING_ID}`;

/** URL Vite serves for the development hydration entry. */
export const DEV_LANDING_ENTRY = `/@id/__x00__${VIRTUAL_LANDING_ID}`;

/**
 * Compile the user's landing component as a browser hydration entry. The
 * source path remains live so a file created after `mcp-use dev` starts can be
 * loaded without replacing Vite's client environment.
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
    resolveId(id) {
      return id === VIRTUAL_LANDING_ID ? RESOLVED_LANDING_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_LANDING_ID) return undefined;
      const source = options.getLandingPath();
      if (source === undefined) return undefined;
      return [
        ...(options.dev === true
          ? ['import "@vitejs/plugin-react/preamble";']
          : []),
        'import { createElement } from "react";',
        'import { hydrateRoot } from "react-dom/client";',
        'import { __setLandingData } from "mcp-use/landing";',
        `import Landing from ${JSON.stringify(source)};`,
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
const RESOLVED_LANDING_SSR_ID = `\0${VIRTUAL_LANDING_SSR_ID}`;

/**
 * Serve `landing.tsx` together with `__withLandingData` to the dev module
 * runner. Importing `mcp-use/landing` from inside the graph, as `landing.tsx`
 * does, gives the setter the module instance the hooks read: the runner
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
        `export { default } from ${JSON.stringify(source)};`,
        'export { __withLandingData } from "mcp-use/landing";',
        "",
      ].join("\n");
    },
  };
}
