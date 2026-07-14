import type { ViewsManifest } from "./types.js";

/**
 * Symbol-keyed method on {@link MCPServer} that primes the views registry
 * from a build/dev manifest.
 *
 * @internal
 */
export const registerViews: unique symbol = Symbol(
  "@mcp-use/server/registerViews"
);

/**
 * Options for priming the views registry.
 *
 * @internal
 */
export interface RegisterViewsOptions {
  /**
   * When true, resource CSP emission appends the serving origin's websocket
   * variant to `connectDomains` so Vite HMR passes host-enforced CSP.
   */
  dev?: boolean;
  /**
   * Absolute project root for resolving the `public/` directory in dev.
   * Defaults to `process.cwd()` when omitted (production `start`).
   */
  projectRoot?: string;
}

/** Type of the {@link registerViews} method on {@link MCPServer}. */
export type RegisterViews = (
  views: ViewsManifest,
  options?: RegisterViewsOptions
) => void;
