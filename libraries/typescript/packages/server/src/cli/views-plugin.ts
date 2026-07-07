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

/**
 * Options for {@link mcpUseViewsPlugin}.
 *
 * @internal
 */
export interface McpUseViewsPluginOptions {
  /** Static list or live getter (dev rediscovery). */
  getViews: () => DiscoveredView[];
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
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    resolveId(id) {
      if (!id.startsWith(VIRTUAL_VIEW_PREFIX)) {
        return undefined;
      }
      return `\0${id}`;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_VIEW_RESOLVED_PREFIX)) {
        return undefined;
      }
      const name = id.slice(VIRTUAL_VIEW_RESOLVED_PREFIX.length);
      const view = options.getViews().find((v) => v.name === name);
      if (view === undefined) {
        return undefined;
      }
      return [
        `import { bootstrapView } from "@mcp-use/server/react";`,
        `import * as viewModule from ${JSON.stringify(view.entryPath)};`,
        `bootstrapView(viewModule);`,
        "",
      ].join("\n");
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
