/**
 * Widget helper utilities
 *
 * This module provides utility functions for widget registration, URI generation,
 * and prop handling.
 */

import type { Hono as HonoType, Context } from "hono";
import type {
  UIResourceContent,
  UIResourceDefinition,
  InputDefinition,
  WidgetProps,
} from "../types/index.js";
import {
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./mcp-ui-adapter.js";
import { isDeno, pathHelpers, fsHelpers, getCwd } from "../utils/runtime.js";

/**
 * Generate a widget URI with optional build ID for cache busting
 *
 * @param widgetName - Widget name/identifier
 * @param buildId - Optional build ID for cache busting
 * @param extension - Optional file extension (e.g., '.html')
 * @param suffix - Optional suffix (e.g., random ID for dynamic URIs)
 * @returns Widget URI with build ID if available
 *
 * @example
 * ```typescript
 * generateWidgetUri('kanban-board', 'abc123', '.html')
 * // Returns: 'ui://widget/kanban-board-abc123.html'
 * ```
 */
export function generateWidgetUri(
  widgetName: string,
  buildId: string | undefined,
  extension: string = "",
  suffix: string = ""
): string {
  const parts = [widgetName];

  // Add build ID if available (for cache busting)
  if (buildId) {
    parts.push(buildId);
  }

  // Add suffix if provided (e.g., random ID for dynamic URIs)
  if (suffix) {
    parts.push(suffix);
  }

  // Construct URI: ui://widget/name-buildId-suffix.extension
  return `ui://widget/${parts.join("-")}${extension}`;
}

/**
 * Convert widget props definition to tool input schema
 *
 * Transforms the widget props configuration into the format expected by
 * the tool registration system, mapping types and handling defaults.
 *
 * @param props - Widget props configuration
 * @returns Array of InputDefinition objects for tool registration
 *
 * @example
 * ```typescript
 * const props = {
 *   title: { type: 'string', required: true, description: 'Board title' },
 *   color: { type: 'string', default: 'blue' }
 * };
 * const inputs = convertPropsToInputs(props);
 * // Returns: [
 * //   { name: 'title', type: 'string', required: true, description: 'Board title' },
 * //   { name: 'color', type: 'string', default: 'blue' }
 * // ]
 * ```
 */
export function convertPropsToInputs(props?: WidgetProps): InputDefinition[] {
  if (!props) return [];

  return Object.entries(props).map(([name, prop]) => ({
    name,
    type: prop.type,
    description: prop.description,
    required: prop.required,
    default: prop.default,
  }));
}

/**
 * Apply default values to widget props
 *
 * Extracts default values from the props configuration to use when
 * the resource is accessed without parameters.
 *
 * @param props - Widget props configuration
 * @returns Object with default values for each prop
 *
 * @example
 * ```typescript
 * const props = {
 *   title: { type: 'string', default: 'My Board' },
 *   color: { type: 'string', default: 'blue' },
 *   size: { type: 'number' } // no default
 * };
 * const defaults = applyDefaultProps(props);
 * // Returns: { title: 'My Board', color: 'blue' }
 * ```
 */
export function applyDefaultProps(props?: WidgetProps): Record<string, any> {
  if (!props) return {};

  const defaults: Record<string, any> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined) {
      defaults[key] = prop.default;
    }
  }
  return defaults;
}

/**
 * Read build manifest file
 *
 * @returns Build manifest or null if not found
 *
 * @example
 * ```typescript
 * const manifest = await readBuildManifest();
 * if (manifest) {
 *   console.log('Build ID:', manifest.buildId);
 *   console.log('Widgets:', manifest.widgets);
 * }
 * ```
 */
export async function readBuildManifest(): Promise<{
  includeInspector: boolean;
  widgets: string[] | Record<string, any>;
  buildTime?: string;
  buildId?: string;
} | null> {
  try {
    const manifestPath = pathHelpers.join(
      isDeno ? "." : getCwd(),
      "dist",
      "mcp-use.json"
    );
    const content = await fsHelpers.readFileSync(manifestPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Server configuration for widget UI resource creation
 */
export interface WidgetServerConfig {
  /** Server host */
  serverHost: string;
  /** Server port */
  serverPort: number;
  /** Server base URL (if configured) */
  serverBaseUrl?: string;
  /** Build ID for cache busting */
  buildId?: string;
}

/**
 * Create a UIResource object for a widget with the given parameters
 *
 * This function creates a consistent UIResource structure that can be rendered
 * by MCP-UI compatible clients. It handles URL configuration, build IDs, and
 * metadata merging.
 *
 * @param definition - UIResource definition
 * @param params - Parameters to pass to the widget via URL
 * @param serverConfig - Server configuration (host, port, baseUrl, buildId)
 * @returns UIResource object compatible with MCP-UI
 *
 * @example
 * ```typescript
 * const serverConfig = {
 *   serverHost: 'localhost',
 *   serverPort: 3000,
 *   serverBaseUrl: 'http://localhost:3000',
 *   buildId: 'abc123'
 * };
 *
 * const definition = {
 *   type: 'appsSdk',
 *   name: 'kanban-board',
 *   title: 'Kanban Board',
 *   htmlTemplate: '<div>...</div>',
 *   appsSdkMetadata: { ... }
 * };
 *
 * const uiResource = await createWidgetUIResource(definition, { title: 'My Board' }, serverConfig);
 * ```
 */
/**
 * Get content type for a file based on its extension
 *
 * @param filename - The filename or path
 * @returns MIME type string
 *
 * @example
 * ```typescript
 * getContentType('script.js') // Returns: 'application/javascript'
 * getContentType('styles.css') // Returns: 'text/css'
 * ```
 */
export function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "js":
      return "application/javascript";
    case "css":
      return "text/css";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/**
 * Process widget HTML with base URL injection and path conversion
 *
 * @param html - Original HTML content
 * @param widgetName - Widget identifier
 * @param baseUrl - Server base URL
 * @returns Processed HTML with injected base tag and absolute URLs
 *
 * @example
 * ```typescript
 * const html = '<html><head></head><body>...</body></html>';
 * const processed = processWidgetHtml(html, 'kanban-board', 'http://localhost:3000');
 * ```
 */
export function processWidgetHtml(
  html: string,
  widgetName: string,
  baseUrl: string
): string {
  let processedHtml = html;

  // Inject or replace base tag with server base URL
  if (baseUrl && processedHtml) {
    // Remove HTML comments temporarily to avoid matching base tags inside comments
    let htmlWithoutComments = processedHtml;
    let prevHtmlWithoutComments;
    do {
      prevHtmlWithoutComments = htmlWithoutComments;
      htmlWithoutComments = htmlWithoutComments.replace(/<!--[\s\S]*?-->/g, "");
    } while (prevHtmlWithoutComments !== htmlWithoutComments);

    // Try to replace existing base tag (only if not in comments)
    const baseTagRegex = /<base\s+[^>]*\/?>/i;
    if (baseTagRegex.test(htmlWithoutComments)) {
      // Find and replace the actual base tag in the original HTML
      const actualBaseTagMatch = processedHtml.match(/<base\s+[^>]*\/?>/i);
      if (actualBaseTagMatch) {
        processedHtml = processedHtml.replace(
          actualBaseTagMatch[0],
          `<base href="${baseUrl}" />`
        );
      }
    } else {
      // Inject base tag in head if it doesn't exist
      const headTagRegex = /<head[^>]*>/i;
      if (headTagRegex.test(processedHtml)) {
        processedHtml = processedHtml.replace(
          headTagRegex,
          (match) => `${match}\n    <base href="${baseUrl}" />`
        );
      }
    }

    // Replace relative paths that start with /mcp-use for scripts and CSS with absolute URLs
    processedHtml = processedHtml.replace(
      /src="\/mcp-use\/widgets\/([^"]+)"/g,
      `src="${baseUrl}/mcp-use/widgets/$1"`
    );
    processedHtml = processedHtml.replace(
      /href="\/mcp-use\/widgets\/([^"]+)"/g,
      `href="${baseUrl}/mcp-use/widgets/$1"`
    );

    // Add window.__getFile and window.__mcpPublicUrl to head
    processedHtml = processedHtml.replace(
      /<head[^>]*>/i,
      `<head>\n    <script>window.__getFile = (filename) => { return "${baseUrl}/mcp-use/widgets/${widgetName}/"+filename }; window.__mcpPublicUrl = "${baseUrl}/mcp-use/public";</script>`
    );
  }

  return processedHtml;
}

/**
 * Create a widget registration object with standard metadata
 *
 * @param widgetName - Widget identifier
 * @param metadata - Widget metadata from file or manifest
 * @param html - Processed HTML template
 * @param serverConfig - Server configuration for CSP and URLs
 * @param isDev - Whether this is development mode
 * @returns Widget registration object
 *
 * @example
 * ```typescript
 * const registration = createWidgetRegistration(
 *   'kanban-board',
 *   { title: 'Kanban Board', description: 'Task board' },
 *   '<html>...</html>',
 *   { serverBaseUrl: 'http://localhost:3000', cspUrls: [] },
 *   true
 * );
 * ```
 */
export function createWidgetRegistration(
  widgetName: string,
  metadata:
    | Record<string, unknown>
    | {
        title?: string;
        description?: string;
        props?: unknown;
        inputs?: unknown;
        schema?: unknown;
        [key: string]: unknown;
      },
  html: string,
  serverConfig: { serverBaseUrl: string; cspUrls: string[] },
  isDev: boolean = false
): {
  name: string;
  title: string;
  description: string;
  type: "appsSdk";
  props: import("../types/resource.js").WidgetProps;
  _meta: Record<string, unknown>;
  htmlTemplate: string;
  appsSdkMetadata: Record<string, any>;
} {
  // Use inputs field (preferred) with fallback to props/schema for backward compatibility
  const props = (metadata.inputs ||
    metadata.props ||
    metadata.schema ||
    {}) as import("../types/resource.js").WidgetProps;
  const description =
    (metadata.description as string | undefined) || `Widget: ${widgetName}`;
  const title = (metadata.title as string | undefined) || widgetName;
  // Extract exposeAsTool flag (defaults to true if not specified)
  const exposeAsTool =
    metadata.exposeAsTool !== undefined ? metadata.exposeAsTool : true;

  const mcp_connect_domain = serverConfig.serverBaseUrl
    ? new URL(serverConfig.serverBaseUrl || "").origin
    : null;

  return {
    name: widgetName,
    title: title as string,
    description: description as string,
    type: "appsSdk",
    props: props as import("../types/resource.js").WidgetProps,
    _meta: {
      "mcp-use/widget": {
        name: widgetName,
        title: title,
        description: description,
        type: "appsSdk",
        props: props,
        html: html,
        dev: isDev,
        exposeAsTool: exposeAsTool,
      },
      ...(metadata._meta || {}),
    },
    htmlTemplate: html,
    appsSdkMetadata: {
      "openai/widgetDescription": description,
      "openai/toolInvocation/invoking": `Loading ${widgetName}...`,
      "openai/toolInvocation/invoked": `${widgetName} ready`,
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
      ...((metadata.appsSdkMetadata as Record<string, unknown> | undefined) ||
        {}),
      "openai/widgetCSP": {
        connect_domains: [
          // always also add the base url of the server
          ...(mcp_connect_domain ? [mcp_connect_domain] : []),
          ...(((metadata.appsSdkMetadata as any)?.["openai/widgetCSP"]
            ?.connect_domains as string[]) || []),
        ],
        resource_domains: [
          "https://*.oaistatic.com",
          "https://*.oaiusercontent.com",
          ...(isDev ? [] : ["https://*.openai.com"]),
          // always also add the base url of the server
          ...(mcp_connect_domain ? [mcp_connect_domain] : []),
          // add additional CSP URLs from environment variable
          ...serverConfig.cspUrls,
          ...(((metadata.appsSdkMetadata as any)?.["openai/widgetCSP"]
            ?.resource_domains as string[]) || []),
        ],
      },
    },
  };
}

export async function createWidgetUIResource(
  definition: UIResourceDefinition,
  params: Record<string, any>,
  serverConfig: WidgetServerConfig
): Promise<UIResourceContent> {
  // If baseUrl is set, parse it to extract protocol, host, and port
  let configBaseUrl = `http://${serverConfig.serverHost}`;
  let configPort: number | string = serverConfig.serverPort || 3000;

  if (serverConfig.serverBaseUrl) {
    try {
      const url = new URL(serverConfig.serverBaseUrl);
      configBaseUrl = `${url.protocol}//${url.hostname}`;
      configPort = url.port || (url.protocol === "https:" ? 443 : 80);
    } catch (e) {
      // Fall back to host:port if baseUrl parsing fails
      console.warn("Failed to parse baseUrl, falling back to host:port", e);
    }
  }

  const urlConfig: UrlConfig = {
    baseUrl: configBaseUrl,
    port: configPort,
    buildId: serverConfig.buildId,
  };

  const uiResource = await createUIResourceFromDefinition(
    definition,
    params,
    urlConfig
  );

  // Merge definition._meta into the resource's _meta
  // This includes mcp-use/widget metadata alongside appsSdkMetadata
  if (definition._meta && Object.keys(definition._meta).length > 0) {
    uiResource.resource._meta = {
      ...uiResource.resource._meta,
      ...definition._meta,
    };
  }

  return uiResource;
}

/**
 * Ensure widget metadata has proper fallback values
 *
 * @param metadata - Widget metadata object
 * @param widgetName - Widget identifier for fallback description
 * @param widgetDescription - Optional custom description
 * @returns Metadata with ensured description
 *
 * @example
 * ```typescript
 * const metadata = ensureWidgetMetadata({}, 'kanban-board');
 * // Returns: { description: 'Widget: kanban-board' }
 * ```
 */
export function ensureWidgetMetadata(
  metadata: Record<string, unknown>,
  widgetName: string,
  widgetDescription?: string
): Record<string, unknown> {
  const result = { ...metadata };

  if (!result.description) {
    result.description = widgetDescription || `Widget: ${widgetName}`;
  }

  return result;
}

/**
 * Read widget HTML file with consistent error handling
 *
 * @param filePath - Path to the HTML file
 * @param widgetName - Widget identifier for error messages
 * @returns HTML content or empty string on error
 *
 * @example
 * ```typescript
 * const html = await readWidgetHtml('/path/to/widget/index.html', 'kanban-board');
 * ```
 */
export async function readWidgetHtml(
  filePath: string,
  widgetName: string
): Promise<string> {
  try {
    return await fsHelpers.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(
      `[WIDGET] Failed to read html template for widget ${widgetName}:`,
      error
    );
    return "";
  }
}

/**
 * Register a widget from its HTML template and metadata
 *
 * This function encapsulates the common pattern of registering a widget:
 * - Read and process HTML template
 * - Ensure metadata has proper fallbacks
 * - Create widget registration object
 * - Call the registration callback
 *
 * @param widgetName - Widget identifier
 * @param htmlPath - Path to the HTML template file
 * @param metadata - Widget metadata
 * @param serverConfig - Server configuration for CSP and URLs
 * @param registerWidget - Callback to register the widget
 * @param isDev - Whether this is development mode
 * @returns Promise that resolves when widget is registered
 *
 * @example
 * ```typescript
 * await registerWidgetFromTemplate(
 *   'kanban-board',
 *   './dist/resources/widgets/kanban-board/index.html',
 *   { title: 'Kanban Board' },
 *   serverConfig,
 *   registerWidget,
 *   false
 * );
 * ```
 */
export async function registerWidgetFromTemplate(
  widgetName: string,
  htmlPath: string,
  metadata: Record<string, unknown>,
  serverConfig: { serverBaseUrl: string; cspUrls: string[] },
  registerWidget: import("./widget-types.js").RegisterWidgetCallback,
  isDev: boolean = false
): Promise<void> {
  // Read and process HTML template
  let html = await readWidgetHtml(htmlPath, widgetName);
  if (!html) {
    return; // readWidgetHtml already logged the error
  }

  // Process HTML with base URL injection and path conversion
  html = processWidgetHtml(html, widgetName, serverConfig.serverBaseUrl);

  // Ensure metadata has proper fallbacks
  const processedMetadata = ensureWidgetMetadata(metadata, widgetName);

  // Create and register the widget
  const widgetRegistration = createWidgetRegistration(
    widgetName,
    processedMetadata,
    html,
    serverConfig,
    isDev
  );

  registerWidget(widgetRegistration);
}

/**
 * Setup static file serving routes for public files
 *
 * Creates an HTTP route to serve files from the public/ or dist/public/ directory.
 * This function encapsulates the common pattern of serving static files.
 *
 * @param app - Hono app instance to mount routes on
 * @param useDistDirectory - Whether to serve from dist/public (production) or public (dev)
 *
 * @example
 * ```typescript
 * // For development mode
 * setupPublicRoutes(app, false);
 *
 * // For production mode
 * setupPublicRoutes(app, true);
 * ```
 */
export function setupPublicRoutes(
  app: HonoType,
  useDistDirectory: boolean = false
): void {
  app.get("/mcp-use/public/*", async (c: Context) => {
    const filePath = c.req.path.replace("/mcp-use/public/", "");
    const basePath = useDistDirectory ? "dist/public" : "public";
    const fullPath = pathHelpers.join(getCwd(), basePath, filePath);

    try {
      if (await fsHelpers.existsSync(fullPath)) {
        const content = await fsHelpers.readFile(fullPath);
        const contentType = getContentType(filePath);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": contentType },
        });
      }
      return c.notFound();
    } catch {
      return c.notFound();
    }
  });
}

/**
 * Setup favicon route at server root
 *
 * Serves the configured favicon file at /favicon.ico so it appears
 * for the entire server domain (e.g., aaa.bbb.com/favicon.ico)
 *
 * @param app - Hono app instance to mount routes on
 * @param faviconPath - Path to favicon file relative to public directory
 * @param useDistDirectory - Whether to serve from dist/public (production) or public (dev)
 *
 * @example
 * ```typescript
 * // For development mode
 * setupFaviconRoute(app, 'favicon.ico', false);
 *
 * // For production mode
 * setupFaviconRoute(app, 'favicon.ico', true);
 * ```
 */
export function setupFaviconRoute(
  app: HonoType,
  faviconPath: string | undefined,
  useDistDirectory: boolean = false
): void {
  if (!faviconPath) {
    return; // No favicon configured
  }

  app.get("/favicon.ico", async (c: Context) => {
    const basePath = useDistDirectory ? "dist/public" : "public";
    const fullPath = pathHelpers.join(getCwd(), basePath, faviconPath);

    try {
      if (await fsHelpers.existsSync(fullPath)) {
        const content = await fsHelpers.readFile(fullPath);
        const contentType = getContentType(faviconPath);
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000", // Cache for 1 year
          },
        });
      }
      return c.notFound();
    } catch {
      return c.notFound();
    }
  });
}
