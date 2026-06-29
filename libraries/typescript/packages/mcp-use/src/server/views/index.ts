/**
 * View mounting and serving utilities.
 *
 * `views/` is the public V2 vocabulary. Some internal filenames, route paths,
 * and wire metadata still use "widget" for migration compatibility with shipped
 * hosts and clients. New public APIs should use view/app naming unless they are
 * intentionally preserving a compatibility alias.
 */

import type { MCPServer } from "../mcp-server.js";
import type {
  RegisterWidgetCallback,
  WidgetMountConfig,
} from "./widget-types.js";
import type { InlineWidgetManifestEntry } from "./inline-widget-middleware.js";
import type { CSPConfig, UnifiedWidgetMetadata } from "./adapters/types.js";
import { isDeno } from "../utils/runtime.js";
import { isProductionMode, getCSPUrls } from "../utils/index.js";
import { shouldMountWidgets } from "./discover-widget-files.js";
import { mountWidgetsDev } from "./mount-widgets-dev.js";
import { mountWidgetsProduction } from "./mount-widgets-production.js";
import { setupWidgetRoutes } from "./setup-widget-routes.js";
import {
  generateEntrySource,
  generateHtmlShell,
  generateStylesSource,
} from "./inline-widget-entry-gen.js";
import {
  registerWidgetFromTemplate,
  slugifyWidgetName,
} from "./widget-helpers.js";

export {
  readBuildManifest,
  setupPublicRoutes,
  setupFaviconRoute,
} from "./widget-helpers.js";

export { uiResourceRegistration } from "./ui-resource-registration.js";

interface ViewMountServerPrivate {
  _inlineWidgetRegistry?: Map<string, InlineWidgetManifestEntry>;
  serverBaseUrl?: string;
  serverHost?: string;
  serverPort?: number | string;
  buildId?: string;
  favicon?: string;
  publicRoutesMode?: WidgetMountConfig["publicRoutesMode"];
  _httpServer?: import("http").Server;
  updateWidgetToolInPlace(
    toolName: string,
    updates: {
      description?: string;
      schema?: unknown;
      _meta?: Record<string, unknown>;
    }
  ): boolean;
  removeWidgetTool(toolName: string): void;
}

/**
 * Mount view files and inline JSX view manifests.
 *
 * In development mode this creates Vite dev middleware with HMR support. In
 * production mode it serves pre-built static view assets. Inline JSX views share
 * this boundary so tool handlers can return components without requiring a
 * `resources/` directory.
 *
 * @param options - Configuration options
 * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
 * @param options.resourcesDir - Directory containing widget files (defaults to 'resources')
 * @returns Promise that resolves when all widgets are mounted
 */
export async function mountViews(
  server: MCPServer<boolean>,
  options?: {
    baseRoute?: string;
    resourcesDir?: string;
  }
): Promise<void> {
  const shouldMountFileWidgets = await shouldMountWidgets(options);
  const viewServer = server as unknown as ViewMountServerPrivate;
  const inlineRegistry = viewServer._inlineWidgetRegistry;
  const hasInlineWidgets = Boolean(inlineRegistry && inlineRegistry.size > 0);

  if (!shouldMountFileWidgets && !hasInlineWidgets) {
    return;
  }

  const serverConfig = {
    serverBaseUrl:
      viewServer.serverBaseUrl ||
      `http://${viewServer.serverHost}:${viewServer.serverPort || 3000}`,
    serverPort: viewServer.serverPort || 3000,
    cspUrls: getCSPUrls(),
    buildId: viewServer.buildId,
    favicon: viewServer.favicon,
    publicRoutesMode: viewServer.publicRoutesMode,
    /** Pre-created HTTP server for Vite HMR WebSocket support */
    httpServer: viewServer._httpServer,
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
    return viewServer.updateWidgetToolInPlace(toolName, updates);
  };

  // Remove callback for HMR - removes tool and resources when widget is deleted/renamed
  const removeWidgetTool = (toolName: string) => {
    viewServer.removeWidgetTool(toolName);
  };

  const app = server.app;

  if (isProductionMode() || isDeno) {
    console.log("[WIDGETS] Mounting widgets in production mode");
    // Setup routes first for production
    setupWidgetRoutes(app, serverConfig);
    viewServer.publicRoutesMode = "production";
    if (shouldMountFileWidgets) {
      await mountWidgetsProduction(app, serverConfig, registerWidget, options);
    }
  } else if (shouldMountFileWidgets) {
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
      viewServer.publicRoutesMode = "dev";
    }
  }

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
        if (!entry.componentPath || !path.isAbsolute(entry.componentPath)) {
          console.warn(
            `[INLINE WIDGET] Skipping ${entry.widgetName}: inline transform manifest did not provide an absolute component path`
          );
          continue;
        }

        const slugName = slugifyWidgetName(entry.widgetName);
        const widgetDir = pathHelpers.join(tempDir, slugName);
        await fs.mkdir(widgetDir, { recursive: true }).catch(() => {});

        const componentRelPath = path.relative(widgetDir, entry.componentPath);

        const entrySource = generateEntrySource(entry, componentRelPath);
        const htmlSource = generateHtmlShell(
          slugName,
          fullBaseUrl,
          serverConfig.favicon
        );
        const componentDir = path.dirname(entry.componentPath);
        const relComponentDir = path
          .relative(widgetDir, componentDir)
          .replace(/\\/g, "/");
        const relMcpUse = path
          .relative(widgetDir, mcpUsePkg)
          .replace(/\\/g, "/");
        const stylesSource = generateStylesSource(relComponentDir, relMcpUse);

        await fs.writeFile(
          pathHelpers.join(widgetDir, "entry.tsx"),
          entrySource,
          "utf8"
        );
        await fs.writeFile(
          pathHelpers.join(widgetDir, "index.html"),
          htmlSource,
          "utf8"
        );
        await fs.writeFile(
          pathHelpers.join(widgetDir, "styles.css"),
          stylesSource,
          "utf8"
        );

        const htmlPath = pathHelpers.join(widgetDir, "index.html");
        const widgetMeta: UnifiedWidgetMetadata = {};
        const csp: CSPConfig = { ...(entry.csp || {}) };

        if (!isProductionMode()) {
          const serverOrigin =
            serverConfig.serverBaseUrl ||
            `http://localhost:${serverConfig.serverPort || 3000}`;
          const wsOrigin = serverOrigin.replace(/^http/, "ws");
          const connectDomains = new Set<string>(csp.connectDomains || []);
          connectDomains.add(wsOrigin);
          csp.connectDomains = Array.from(connectDomains);
          csp.scriptDirectives = [
            ...(csp.scriptDirectives || []),
            "'unsafe-eval'",
          ];
        }

        if (Object.keys(csp).length > 0) widgetMeta.csp = csp;
        if (entry.prefersBorder !== undefined)
          widgetMeta.prefersBorder = entry.prefersBorder;
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

        console.log(
          `[INLINE WIDGET] ${entry.widgetName} registered as resource`
        );
      }
    } catch (err) {
      console.error("[INLINE WIDGET] Failed to process inline widgets:", err);
    }
  }
}

/** @deprecated Use `mountViews()` instead. @alias */
export const mountWidgets = mountViews;
