/**
 * Widget mounting and serving utilities
 *
 * This module provides functions for mounting and serving MCP widgets in both
 * development and production modes.
 */

import type { MCPServer } from "../mcp-server.js";
import type { RegisterWidgetCallback } from "./widget-types.js";
import { isDeno } from "../utils/runtime.js";
import { isProductionMode, getCSPUrls } from "../utils/index.js";
import { mountWidgetsDev } from "./mount-widgets-dev.js";
import { mountWidgetsProduction } from "./mount-widgets-production.js";
import { setupWidgetRoutes } from "./setup-widget-routes.js";
import { generateEntrySource, generateHtmlShell, generateStylesSource } from "./inline-widget-entry-gen.js";
import { registerWidgetFromTemplate, slugifyWidgetName } from "./widget-helpers.js";

export {
  mountWidgetsDev,
  type MountWidgetsDevOptions,
} from "./mount-widgets-dev.js";

export {
  mountWidgetsProduction,
  type MountWidgetsProductionOptions,
} from "./mount-widgets-production.js";

export { setupWidgetRoutes } from "./setup-widget-routes.js";

export {
  createUIResourceFromDefinition,
  buildWidgetUrl,
  createExternalUrlResource,
  createRawHtmlResource,
  createRemoteDomResource,
  createAppsSdkResource,
  type UrlConfig,
} from "./mcp-ui-adapter.js";

export {
  generateWidgetUri,
  slugifyWidgetName,
  convertPropsToInputs,
  applyDefaultProps,
  readBuildManifest,
  createWidgetUIResource,
  getContentType,
  processWidgetHtml,
  createWidgetRegistration,
  ensureWidgetMetadata,
  readWidgetHtml,
  registerWidgetFromTemplate,
  setupPublicRoutes,
  setupFaviconRoute,
  type WidgetServerConfig,
} from "./widget-helpers.js";

export {
  uiResourceRegistration,
  type UIResourceServer,
} from "./ui-resource-registration.js";

export {
  type ServerConfig,
  type MountWidgetsOptions,
  type RegisterWidgetCallback,
  type UpdateWidgetToolCallback,
  type RemoveWidgetToolCallback,
} from "./widget-types.js";

// Inline widget transform and middleware
export {
  inlineWidgetTransformPlugin,
  transformInlineWidgets,
  type InlineWidgetManifest,
  type TransformResult,
} from "./inline-widget-transform.js";

export {
  InlineWidgetRegistry,
  createInlineWidgetMiddleware,
  type InlineWidgetManifestEntry,
} from "./inline-widget-middleware.js";

export {
  generateEntrySource,
  generateHtmlShell,
  generateStylesSource,
  generateInlineWidgetFiles,
  type InlineWidgetTempFiles,
} from "./inline-widget-entry-gen.js";

export {
  diffManifests,
  createInlineWidgetTempFiles,
  removeInlineWidgetTempFiles,
  readComponentConfig,
  mergeWidgetConfigs,
  processInlineWidgetManifest,
  handleManifestDiff,
  serializeManifestForBuild,
  deserializeManifestFromBuild,
} from "./inline-widget-bundler.js";

export { inlineWidgetEsbuildPlugin } from "./inline-widget-esbuild-plugin.js";

/**
 * Mount widget files - automatically chooses between dev and production mode
 *
 * In development mode: creates Vite dev servers with HMR support
 * In production mode: serves pre-built static widgets
 *
 * @param options - Configuration options
 * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
 * @param options.resourcesDir - Directory containing widget files (defaults to 'resources')
 * @returns Promise that resolves when all widgets are mounted
 */
export async function mountWidgets(
  server: MCPServer,
  options?: {
    baseRoute?: string;
    resourcesDir?: string;
  }
): Promise<void> {
  const serverConfig = {
    serverBaseUrl:
      (server as any).serverBaseUrl ||
      `http://${(server as any).serverHost}:${(server as any).serverPort || 3000}`,
    serverPort: (server as any).serverPort || 3000,
    cspUrls: getCSPUrls(),
    buildId: (server as any).buildId,
    favicon: (server as any).favicon,
    publicRoutesMode: (server as any).publicRoutesMode,
    /** Pre-created HTTP server for Vite HMR WebSocket support */
    httpServer: (server as any)._httpServer as
      | import("http").Server
      | undefined,
  };

  const registerWidget: RegisterWidgetCallback = (widgetDef) => {
    server.uiResource(widgetDef);
  };

  // Update callback for HMR - directly updates tool config without re-registering.
  // Returns false if the tool doesn't exist (e.g., removed by index.ts HMR sync),
  // so the caller can fall back to full registration.
  const updateWidgetTool = (
    toolName: string,
    updates: {
      description?: string;
      schema?: unknown;
      _meta?: Record<string, unknown>;
    }
  ): boolean => {
    return (server as any).updateWidgetToolInPlace(toolName, updates);
  };

  // Remove callback for HMR - removes tool and resources when widget is deleted/renamed
  const removeWidgetTool = (toolName: string) => {
    (server as any).removeWidgetTool(toolName);
  };

  const app = server.app;

  if (isProductionMode() || isDeno) {
    console.log("[WIDGETS] Mounting widgets in production mode");
    // Setup routes first for production
    setupWidgetRoutes(app, serverConfig);
    (server as any).publicRoutesMode = "production";
    await mountWidgetsProduction(app, serverConfig, registerWidget, options);
  } else {
    console.log("[WIDGETS] Mounting widgets in development mode");
    await mountWidgetsDev(
      app,
      serverConfig,
      registerWidget,
      updateWidgetTool,
      removeWidgetTool,
      options
    );
    // Mark routes as set up if they weren't already (mountWidgetsDev may have set them up)
    if (!serverConfig.publicRoutesMode) {
      (server as any).publicRoutesMode = "dev";
    }
  }

  // ── Process inline widgets detected from JSX returns ──────────────────
  const inlineRegistry = (server as any)._inlineWidgetRegistry as
    | Map<string, import("./inline-widget-middleware.js").InlineWidgetManifestEntry>
    | undefined;

  if (inlineRegistry && inlineRegistry.size > 0) {
    try {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      const { getCwd, pathHelpers } = await import("../utils/runtime.js");

      const cwd = getCwd();
      const tempDir = pathHelpers.join(cwd, ".mcp-use");
      await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

      const baseRoute = options?.baseRoute || "/mcp-use/widgets";
      const fullBaseUrl = `${serverConfig.serverBaseUrl}${baseRoute}`;
      const mcpUsePkg = pathHelpers.join(cwd, "node_modules", "mcp-use");

      for (const [, entry] of inlineRegistry) {
        const slugName = slugifyWidgetName(entry.widgetName);
        const widgetDir = pathHelpers.join(tempDir, slugName);
        await fs.mkdir(widgetDir, { recursive: true }).catch(() => {});

        // Resolve component path relative to the widget dir
        let componentRelPath: string;
        if (entry.componentPath && path.isAbsolute(entry.componentPath)) {
          componentRelPath = path.relative(widgetDir, entry.componentPath);
        } else {
          componentRelPath = "../../components/" + entry.widgetName
            .split("-")
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join("");
        }

        const entrySource = generateEntrySource(entry, componentRelPath);
        const htmlSource = generateHtmlShell(slugName, fullBaseUrl, serverConfig.favicon);
        const componentDir = entry.componentPath
          ? path.dirname(entry.componentPath)
          : pathHelpers.join(cwd, "components");
        const relComponentDir = path.relative(widgetDir, componentDir).replace(/\\/g, "/");
        const relMcpUse = path.relative(widgetDir, mcpUsePkg).replace(/\\/g, "/");
        const stylesSource = generateStylesSource(relComponentDir, relMcpUse);

        await fs.writeFile(pathHelpers.join(widgetDir, "entry.tsx"), entrySource, "utf8");
        await fs.writeFile(pathHelpers.join(widgetDir, "index.html"), htmlSource, "utf8");
        await fs.writeFile(pathHelpers.join(widgetDir, "styles.css"), stylesSource, "utf8");

        const htmlPath = pathHelpers.join(widgetDir, "index.html");
        // Build the unified metadata.metadata object that createWidgetRegistration expects
        const widgetMeta: Record<string, any> = {};
        const csp: Record<string, any> = { ...(entry.csp || {}) };

        // In dev mode, add ws:// origin for Vite HMR and 'unsafe-eval' for Zod JIT
        if (!isProductionMode()) {
          const serverOrigin = serverConfig.serverBaseUrl || `http://localhost:${serverConfig.serverPort || 3000}`;
          const wsOrigin = serverOrigin.replace(/^http/, "ws");
          const connectDomains = new Set<string>(csp.connectDomains || []);
          connectDomains.add(wsOrigin);
          csp.connectDomains = Array.from(connectDomains);
          csp.scriptDirectives = [...(csp.scriptDirectives || []), "'unsafe-eval'"];
        }

        if (Object.keys(csp).length > 0) widgetMeta.csp = csp;
        if (entry.prefersBorder !== undefined) widgetMeta.prefersBorder = entry.prefersBorder;
        if (entry.domain) widgetMeta.domain = entry.domain;
        if (entry.permissions) widgetMeta.permissions = entry.permissions;

        const metadata: Record<string, unknown> = {
          description: `Inline widget: ${entry.widgetName}`,
          metadata: widgetMeta,
        };

        await registerWidgetFromTemplate(
          entry.widgetName,
          htmlPath,
          metadata,
          serverConfig,
          registerWidget,
          true
        );

        console.log(`[INLINE WIDGET] ${entry.widgetName} registered as resource`);
      }
    } catch (err) {
      console.error("[INLINE WIDGET] Failed to process inline widgets:", err);
    }
  }
}
