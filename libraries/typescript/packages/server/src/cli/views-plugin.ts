/**
 * Vite plugin: virtual view entry modules and optional SSR wrapper entry.
 */

import type { Plugin } from "vite";

import type { DiscoveredView } from "./views.js";
import {
  VIRTUAL_VIEW_PREFIX,
  VIRTUAL_VIEW_RESOLVED_PREFIX,
  virtualViewId,
} from "./views.js";

const VIRTUAL_TAILWIND_ID = "virtual:mcp-use/tailwind.css";
const VIRTUAL_TAILWIND_RESOLVED_ID = `\0${VIRTUAL_TAILWIND_ID}`;
const VIRTUAL_CSP_RUNTIME_ID = "virtual:mcp-use/csp-runtime";
const VIRTUAL_CSP_RUNTIME_RESOLVED_ID = `\0${VIRTUAL_CSP_RUNTIME_ID}`;

/** React packages that must resolve to one browser module in managed views. */
export const VIEW_REACT_DEDUPE = ["react", "react-dom"];

/**
 * Keep the framework's ESM view runtime out of Vite's dependency bundle while
 * pre-bundling the CommonJS React entry points it imports.
 */
export const VIEW_REACT_OPTIMIZE_DEPS = {
  exclude: ["mcp-use/react"],
  include: ["react", "react-dom", "react-dom/client"],
};

/**
 * Options for {@link mcpUseViewsPlugin}.
 *
 * @internal
 */
export interface McpUseViewsPluginOptions {
  /** Static list or live getter (dev rediscovery). */
  getViews: () => DiscoveredView[];
  /**
   * Dev-mode entry shape. When present, every virtual entry self-accepts HMR
   * updates (`import.meta.hot.accept()`) so an update that propagates past the
   * view module re-runs the bootstrap instead of full-reloading the iframe
   * document (which would wipe bridge state). Absent for builds — entries stay
   * byte-identical to the production contract.
   */
  dev?: {
    /**
     * Whether React Fast Refresh is active (`@vitejs/plugin-react` resolved).
     * When `true`, entries import the plugin's virtual refresh preamble
     * (`@vitejs/plugin-react/preamble`) before any component module so the
     * refresh runtime hooks the document — the role `transformIndexHtml`
     * plays for Vite-served HTML, which synthesized srcdoc documents never
     * pass through.
     */
    reactRefresh: boolean;
  };
}

/**
 * Vite plugin that resolves `virtual:mcp-use/views/<name>` to bootstrap code.
 *
 * Applies only to the **client** environment.
 *
 * @internal
 */
export function mcpUseViewsPlugin(options: McpUseViewsPluginOptions): Plugin {
  return {
    name: "mcp-use-views",
    config() {
      return {
        // Vite may otherwise resolve the view source and the pre-bundled
        // mcp-use/react entry to versioned and unversioned React URLs. Those
        // are distinct browser modules and trigger React's invalid-hook-call
        // guard even though they originate from the same installed package.
        resolve: { dedupe: VIEW_REACT_DEDUPE },
        optimizeDeps: VIEW_REACT_OPTIMIZE_DEPS,
      };
    },
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    resolveId(id) {
      if (id === VIRTUAL_CSP_RUNTIME_ID) {
        return VIRTUAL_CSP_RUNTIME_RESOLVED_ID;
      }
      if (id === VIRTUAL_TAILWIND_ID) {
        return VIRTUAL_TAILWIND_RESOLVED_ID;
      }
      if (!id.startsWith(VIRTUAL_VIEW_PREFIX)) {
        return undefined;
      }
      return `\0${id}`;
    },
    load(id) {
      if (id === VIRTUAL_CSP_RUNTIME_RESOLVED_ID) {
        // Zod 4 deliberately exposes this global configuration object so
        // strict-CSP hosts can opt out of its new Function capability probe
        // before Zod evaluates. The probe is caught by Zod, but browsers still
        // report it as a CSP violation.
        return [
          "globalThis.__zod_globalConfig ??= {};",
          "globalThis.__zod_globalConfig.jitless = true;",
          "",
        ].join("\n");
      }
      if (id === VIRTUAL_TAILWIND_RESOLVED_ID) {
        // Host theme is applied via ext-apps applyDocumentTheme (data-theme on
        // html) and optional .dark wrappers — not OS prefers-color-scheme.
        return [
          '@import "tailwindcss";',
          "@custom-variant dark (&:where(.dark, .dark *, [data-theme=dark], [data-theme=dark] *));",
        ].join("\n");
      }
      if (!id.startsWith(VIRTUAL_VIEW_RESOLVED_PREFIX)) {
        return undefined;
      }
      const name = id.slice(VIRTUAL_VIEW_RESOLVED_PREFIX.length);
      const view = options.getViews().find((v) => v.name === name);
      if (view === undefined) {
        return undefined;
      }
      const lines: string[] = [];
      // This side-effect module must evaluate before the view and all of its
      // dependencies so strict-CSP configuration is in place before Zod loads.
      lines.push(`import ${JSON.stringify(VIRTUAL_CSP_RUNTIME_ID)};`);
      if (options.dev?.reactRefresh === true) {
        // Must precede component imports: the preamble hooks the refresh
        // runtime into the window before react-dom (via the bootstrap import
        // below) or any refresh-wrapped view module evaluates.
        lines.push(`import "@vitejs/plugin-react/preamble";`);
      }
      lines.push(`import ${JSON.stringify(VIRTUAL_TAILWIND_ID)};`);
      lines.push(
        `import { bootstrapView } from "mcp-use/react";`,
        `import * as viewModule from ${JSON.stringify(view.entryPath)};`,
        `bootstrapView(viewModule);`
      );
      if (options.dev !== undefined) {
        lines.push(
          `if (import.meta.hot) {`,
          `  import.meta.hot.accept();`,
          `}`
        );
      }
      lines.push("");
      return lines.join("\n");
    },
  };
}

/**
 * Rollup input map for a client views build (one entry per view).
 *
 * @internal
 */
export function clientBuildInputs(
  views: DiscoveredView[]
): Record<string, string> {
  const input: Record<string, string> = {};
  for (const view of views) {
    input[view.name] = virtualViewId(view.name);
  }
  return input;
}
