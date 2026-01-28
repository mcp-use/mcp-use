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
  };

  const registerWidget: RegisterWidgetCallback = (widgetDef) => {
    server.uiResource(widgetDef);
  };

  // Update callback for HMR - directly updates tool config without re-registering
  const updateWidgetTool = (
    toolName: string,
    updates: {
      description?: string;
      schema?: unknown;
      _meta?: Record<string, unknown>;
    }
  ) => {
    (server as any).updateWidgetToolInPlace(toolName, updates);
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
}
