/**
 * Production mode widget mounting
 *
 * This module handles serving pre-built widgets from the dist/resources/widgets/ directory.
 * Widgets are built using the 'mcp-use build' command and served as static files in production.
 */

import type { Hono as HonoType } from "hono";
import type { WidgetMetadata } from "../types/widget.js";
import { isDeno, pathHelpers, fsHelpers, getCwd } from "../utils/runtime.js";
import { registerWidgetFromTemplate } from "./widget-helpers.js";
import type {
  ServerConfig,
  MountWidgetsOptions,
  RegisterWidgetCallback,
} from "./widget-types.js";

/**
 * Configuration for production widget mounting
 */
export type MountWidgetsProductionOptions = MountWidgetsOptions;

/**
 * Mount pre-built widgets from dist/resources/widgets/ directory in production mode
 *
 * Serves static widget bundles that were built using the build command.
 * Reads the manifest file to discover available widgets and their metadata,
 * then registers each widget as both a tool and resource.
 *
 * @param app - Hono app instance (not used directly, kept for consistency)
 * @param serverConfig - Server configuration (baseUrl, CSP URLs, buildId)
 * @param registerWidget - Callback to register each discovered widget
 * @param options - Optional configuration (baseRoute)
 * @returns Promise that resolves when all widgets are mounted
 */
export async function mountWidgetsProduction(
  app: HonoType,
  serverConfig: ServerConfig,
  registerWidget: RegisterWidgetCallback,
  options?: MountWidgetsProductionOptions
): Promise<void> {
  const baseRoute = options?.baseRoute || "/mcp-use/widgets";
  const widgetsDir = pathHelpers.join(
    isDeno ? "." : getCwd(),
    "dist",
    "resources",
    "widgets"
  );

  console.log("widgetsDir", widgetsDir);

  // Discover built widgets from manifest
  const manifestPath = "./dist/mcp-use.json";
  let widgets: string[] = [];
  let widgetsMetadata: Record<string, any> = {};

  try {
    const manifestContent = await fsHelpers.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    // Store build ID from manifest for use in widget URIs (passed via serverConfig)
    if (manifest.buildId && typeof manifest.buildId === "string") {
      serverConfig.buildId = manifest.buildId;
      console.log(`[WIDGETS] Build ID: ${manifest.buildId}`);
    }

    if (
      manifest.widgets &&
      typeof manifest.widgets === "object" &&
      !Array.isArray(manifest.widgets)
    ) {
      // New format: widgets is an object with widget names as keys and metadata as values
      widgets = Object.keys(manifest.widgets);
      widgetsMetadata = manifest.widgets;
      console.log(`[WIDGETS] Loaded ${widgets.length} widget(s) from manifest`);
    } else if (manifest.widgets && Array.isArray(manifest.widgets)) {
      // Legacy format: widgets is an array of strings
      widgets = manifest.widgets;
      console.log(
        `[WIDGETS] Loaded ${widgets.length} widget(s) from manifest (legacy format)`
      );
    } else {
      console.log("[WIDGETS] No widgets found in manifest");
    }
  } catch (error) {
    console.log(
      "[WIDGETS] Could not read manifest file, falling back to directory listing:",
      error
    );

    // Fallback to directory listing if manifest doesn't exist
    try {
      const allEntries = await fsHelpers.readdirSync(widgetsDir);
      for (const name of allEntries) {
        const widgetPath = pathHelpers.join(widgetsDir, name);
        const indexPath = pathHelpers.join(widgetPath, "index.html");
        if (await fsHelpers.existsSync(indexPath)) {
          widgets.push(name);
        }
      }
    } catch (dirError) {
      console.log("[WIDGETS] Directory listing also failed:", dirError);
    }
  }

  if (widgets.length === 0) {
    console.log("[WIDGETS] No built widgets found");
    return;
  }

  console.log(
    `[WIDGETS] Serving ${widgets.length} pre-built widget(s) from dist/resources/widgets/`
  );

  // Register tools and resources for each widget
  for (const widgetName of widgets) {
    const widgetPath = pathHelpers.join(widgetsDir, widgetName);
    const indexPath = pathHelpers.join(widgetPath, "index.html");

    // Get metadata from manifest
    const metadata: WidgetMetadata = widgetsMetadata[widgetName] || {};

    const mcp_connect_domain = serverConfig.serverBaseUrl
      ? new URL(serverConfig.serverBaseUrl || "").origin
      : null;

    console.log("[CSP] mcp_connect_domain", mcp_connect_domain);
    console.log("[CSP] cspUrls", serverConfig.cspUrls);
    console.log("[CSP] metadata.appsSdkMetadata", metadata.appsSdkMetadata);
    console.log("[CSP] metadata._meta", metadata._meta);

    // Use the extracted helper to register the widget
    await registerWidgetFromTemplate(
      widgetName,
      indexPath,
      metadata,
      serverConfig,
      registerWidget,
      false // isDev
    );

    console.log(`[WIDGET] ${widgetName} mounted at ${baseRoute}/${widgetName}`);
  }
}
