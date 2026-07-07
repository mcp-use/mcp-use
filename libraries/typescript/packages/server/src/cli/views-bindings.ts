/**
 * Build-time view binding validation via mount-time checks.
 */

import { createServerModuleRunner, type DevEnvironment } from "vite";

import type { ViewsManifest } from "../views/types.js";

/**
 * Duck-typed server shape needed for binding validation.
 *
 * @internal
 */
interface ServerLike {
  getHandler(): unknown;
  __primeViews(views: ViewsManifest, options?: { dev?: boolean }): void;
}

/**
 * Prime the server with the manifest and run mount-time binding validation
 * by calling `getHandler()`.
 *
 * Surfaces the same errors as runtime mount: missing primed view, missing
 * `outputSchema`, double binding. Unbound views emit a warning to stderr.
 *
 * @param environment - Vite SSR environment for module evaluation.
 * @param entry - Absolute path to the user's server entry.
 * @param viewsManifest - Built or dev-shaped manifest to prime.
 * @throws On binding hard errors (naming the view/tool).
 *
 * @internal
 */
export async function validateViewBindingsAtBuild(
  environment: DevEnvironment,
  entry: string,
  viewsManifest: ViewsManifest
): Promise<void> {
  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  try {
    const serverModule = (await runner.import(entry)) as {
      default?: ServerLike;
    };
    const server = serverModule.default;
    if (server === null || typeof server !== "object") {
      throw new Error(
        "The server entry must default-export the MCPServer instance."
      );
    }

    if (typeof server.__primeViews !== "function") {
      throw new Error(
        "The entry's default export does not support __primeViews."
      );
    }
    server.__primeViews(viewsManifest);
    server.getHandler();
  } finally {
    await runner.close();
  }
}
