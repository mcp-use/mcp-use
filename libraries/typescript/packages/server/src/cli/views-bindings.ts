/**
 * Build-time view binding validation via mount-time checks.
 */

import { createServerModuleRunner, type DevEnvironment } from "vite";

import type { ViewsManifest } from "../views/types.js";
import { legacyWidgetMetadataId } from "./legacy-widget-metadata.js";
import type { DiscoveredView } from "./views.js";

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
  __registerLegacyViews?(widgets: Record<string, unknown>): void;
}

const COMPAT_GLOBAL = "__mcpUseV1CompatServer";

function capturedCompatServer(): ServerLike | undefined {
  return (globalThis as Record<string, unknown>)[COMPAT_GLOBAL] as
    | ServerLike
    | undefined;
}

async function registerLegacyViews(
  runner: ReturnType<typeof createServerModuleRunner>,
  server: ServerLike,
  views: readonly DiscoveredView[]
): Promise<void> {
  const legacy = views.filter((view) => view.legacy === true);
  if (legacy.length === 0) return;
  if (typeof server.__registerLegacyViews !== "function") {
    throw new Error(
      "Legacy resources/*/widget.tsx views require the temporary mcp-use/server compatibility entry."
    );
  }
  const modules: Record<string, unknown> = {};
  for (const view of legacy) {
    modules[view.name] = await runner.import(
      legacyWidgetMetadataId(view.entryPath)
    );
  }
  server.__registerLegacyViews(modules);
}

/** Build-time facts discovered by evaluating only the server entry. */
export interface BuildEntryInspection {
  /** Configured MCP route. */
  basePath: string;
  /** Whether the entry captured the deprecated v1 compatibility server. */
  supportsLegacyViews: boolean;
}

/**
 * Import the server entry and read `basePath` from the default export.
 *
 * Does not prime views or mount the server. Sets a synthetic `MCP_URL` only
 * when unset so OAuth entries can construct during build introspection.
 *
 * @internal
 */
export async function inspectBuildEntry(
  environment: DevEnvironment,
  entry: string
): Promise<BuildEntryInspection> {
  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const previousMcpUrl = process.env["MCP_URL"];
  const previousCliImport = process.env["MCP_USE_CLI_IMPORT"];
  try {
    process.env["MCP_USE_CLI_IMPORT"] = "1";
    if (previousMcpUrl === undefined) {
      process.env["MCP_URL"] = BUILD_ENTRY_MCP_URL;
    }

    delete (globalThis as Record<string, unknown>)[COMPAT_GLOBAL];
    const serverModule = (await runner.import(entry)) as {
      default?: ServerLike;
    };
    const server = serverModule.default ?? capturedCompatServer();
    if (server === null || typeof server !== "object") {
      throw new Error(
        "The server entry must default-export the MCPServer instance."
      );
    }

    return {
      basePath: server.basePath ?? DEFAULT_BASE_PATH,
      supportsLegacyViews: typeof server.__registerLegacyViews === "function",
    };
  } finally {
    delete (globalThis as Record<string, unknown>)[COMPAT_GLOBAL];
    if (previousMcpUrl === undefined) {
      delete process.env["MCP_URL"];
    } else {
      process.env["MCP_URL"] = previousMcpUrl;
    }
    if (previousCliImport === undefined) {
      delete process.env["MCP_USE_CLI_IMPORT"];
    } else {
      process.env["MCP_USE_CLI_IMPORT"] = previousCliImport;
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
  return (await inspectBuildEntry(environment, entry)).basePath;
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
  viewsManifest: ViewsManifest,
  views: readonly DiscoveredView[] = []
): Promise<void> {
  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });
  const previousCliImport = process.env["MCP_USE_CLI_IMPORT"];

  try {
    process.env["MCP_USE_CLI_IMPORT"] = "1";
    delete (globalThis as Record<string, unknown>)[COMPAT_GLOBAL];
    const serverModule = (await runner.import(entry)) as {
      default?: ServerLike;
    };
    const server = serverModule.default ?? capturedCompatServer();
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
    await registerLegacyViews(runner, server, views);
    server.__primeViews(viewsManifest);
    server.__mount();
  } finally {
    delete (globalThis as Record<string, unknown>)[COMPAT_GLOBAL];
    if (previousCliImport === undefined) {
      delete process.env["MCP_USE_CLI_IMPORT"];
    } else {
      process.env["MCP_USE_CLI_IMPORT"] = previousCliImport;
    }
    await runner.close();
  }
}
