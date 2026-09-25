/** Browser entry for a CLI-discovered `landing.tsx`. */

import type { Plugin } from "vite";

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
        `import Landing from ${JSON.stringify(source)};`,
        'const root = document.getElementById("mcp-use-landing-root");',
        'const propsNode = document.getElementById("mcp-use-landing-props");',
        "if (root && propsNode) {",
        '  hydrateRoot(root, createElement(Landing, JSON.parse(propsNode.textContent || "{}")));',
        "}",
        "",
      ].join("\n");
    },
  };
}
