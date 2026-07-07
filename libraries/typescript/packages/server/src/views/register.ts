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

/** Type of the {@link registerViews} method on {@link MCPServer}. */
export type RegisterViews = (views: ViewsManifest) => void;
