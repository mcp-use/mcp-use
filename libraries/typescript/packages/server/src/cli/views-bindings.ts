/**
 * Build-time view binding validation via mount-time checks.
 */

import { createServerModuleRunner, type DevEnvironment } from "vite";

import type { ViewsManifest } from "../views/types.js";

const DEFAULT_BASE_PATH = "/mcp";

/** Synthetic origin for entry evaluation when OAuth needs MCP_URL at import. */
const BUILD_ENTRY_MCP_URL = "http://localhost:3000";

/**
 * Duck-typed server shape needed for binding validation.
 *
 * @internal
 */
interface ServerLike {
  __mount(): void;
  __primeViews(views: ViewsManifest, options?: { dev?: boolean }): void;
  basePath?: string;
}

/**
 * Import the server entry and read `basePath` from the default export.
 *
 * Does not prime views or mount the server. Sets a synthetic `MCP_URL` only
 * when unset so OAuth entries can construct during build introspection.
 *
 * @internal
 */
async function inspectBuildEntry(
  environment: DevEnvironment,
  entry: string
): Promise<string> {
  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const previousMcpUrl = process.env["MCP_URL"];
  try {
    if (previousMcpUrl === undefined) {
      process.env["MCP_URL"] = BUILD_ENTRY_MCP_URL;
    }

    const serverModule = (await runner.import(entry)) as {
      default?: ServerLike;
    };
    const server = serverModule.default;
    if (server === null || typeof server !== "object") {
      throw new Error(
        "The server entry must default-export the MCPServer instance."
      );
    }

    return server.basePath ?? DEFAULT_BASE_PATH;
  } finally {
    if (previousMcpUrl === undefined) {
      delete process.env["MCP_URL"];
    } else {
      process.env["MCP_URL"] = previousMcpUrl;
    }
    await runner.close();
  }
}

/**
 * Import the server entry and read its configured MCP route.
 *
 * @internal
 */
export async function resolveBuildBasePath(
  environment: DevEnvironment,
  entry: string
): Promise<string> {
  return inspectBuildEntry(environment, entry);
}

/**
 * Prime the server with the manifest and run mount-time binding validation
 * by mounting the application.
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
  const previousMcpUrl = process.env["MCP_URL"];

  try {
    if (previousMcpUrl === undefined) {
      process.env["MCP_URL"] = BUILD_ENTRY_MCP_URL;
    }
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
    server.__mount();
  } finally {
    if (previousMcpUrl === undefined) {
      delete process.env["MCP_URL"];
    } else {
      process.env["MCP_URL"] = previousMcpUrl;
    }
    await runner.close();
  }
}
