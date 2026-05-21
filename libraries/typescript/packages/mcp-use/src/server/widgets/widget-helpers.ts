/**
 * Widget helper utilities
 *
 * This module provides utility functions for widget registration, URI generation,
 * and prop handling.
 */

import type { Context, Hono as HonoType } from "hono";
import type {
  InputDefinition,
  UIResourceContent,
  UIResourceDefinition,
  WidgetProps,
} from "../types/index.js";
import { fsHelpers, getCwd, isDeno, pathHelpers } from "../utils/runtime.js";
import {
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./mcp-ui-adapter.js";

/**
 * Slugify a widget name to make it URI-safe
 *
 * Converts widget names to valid URI components by:
 * - Converting to lowercase
 * - Replacing spaces and invalid characters with dashes
 * - Removing consecutive dashes
 * - Trimming dashes from start/end
 *
 * @param name - Widget name to slugify
 * @returns URI-safe slugified name
 *
 * @example
 * ```typescript
 * slugifyWidgetName('My Awesome Widget')
 * // Returns: 'my-awesome-widget'
 *
 * slugifyWidgetName('Product Search Results 2')
 * // Returns: 'product-search-results-2'
 * ```
 */
export function slugifyWidgetName(name: string): string {
  // Prevent ReDoS by limiting input length
  const MAX_LENGTH = 300;
  if (name.length > MAX_LENGTH) {
    name = name.substring(0, MAX_LENGTH);
  }

  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, "-") // Replace invalid chars with dash
    .replace(/-+/g, "-") // Replace multiple consecutive dashes with single dash
    .replace(/^-+/, "") // Trim dashes from start
    .replace(/-+$/, ""); // Trim dashes from end
}

/**
 * Generate a widget URI with optional build ID for cache busting
 *
 * The widget name is automatically slugified to ensure URI compliance.
 *
 * @param widgetName - Widget name/identifier (will be slugified)
 * @param buildId - Optional build ID for cache busting
 * @param extension - Optional file extension (e.g., '.html')
 * @param suffix - Optional suffix (e.g., random ID for dynamic URIs)
 * @returns Widget URI with build ID if available
 *
 * @example
 * ```typescript
 * generateWidgetUri('kanban-board', 'abc123', '.html')
 * // Returns: 'ui://widget/kanban-board-abc123.html'
 *
 * generateWidgetUri('My Widget', 'abc123', '.html')
 * // Returns: 'ui://widget/my-widget-abc123.html'
 * ```
 */
export function generateWidgetUri(
  widgetName: string,
  buildId: string | undefined,
  extension: string = "",
  suffix: string = ""
): string {
  // Slugify the widget name to ensure URI compliance
  const slugifiedName = slugifyWidgetName(widgetName);
  const parts = [slugifiedName];

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
      ".mcp-use",
      "manifest.json"
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
 * Inject runtime globals into widget HTML.
 *
 * Production builds bake these globals at build time
 * (`packages/cli/src/index.ts`), so this function is effectively dev-only —
 * the CLI's `buildWidgets` already wrote the script into `.mcp-use/widgets/
 * &lt;name&gt;/index.html` before it lands on disk. It stays here for the dev
 * Vite middleware, which serves un-baked HTML on the fly.
 *
 * Idempotent: if the globals are already present (production reads), this
 * is a no-op.
 *
 * @param html - Original HTML content
 * @param widgetName - Widget identifier (will be slugified for URL paths)
 * @returns HTML with the globals script injected after the opening `<head>`
 */
export function processWidgetHtml(html: string, widgetName: string): string {
  if (!html || html.includes("window.__mcpPublicUrl")) {
    return html;
  }

  const slugifiedName = slugifyWidgetName(widgetName);
  return html.replace(
    /<head[^>]*>/i,
    (match) =>
      `${match}\n    <script>window.__getFile = (filename) => { return "/_mcp-use/widgets/${slugifiedName}/"+filename }; window.__mcpPublicUrl = "/_mcp-use/public";</script>`
  );
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
function createWidgetRegistration(
  widgetName: string,
  metadata:
    | Record<string, unknown>
    | {
        title?: string;
        description?: string;
        props?: unknown;
        inputs?: unknown;
        schema?: unknown;
        metadata?: unknown;
        appsSdkMetadata?: unknown;
        [key: string]: unknown;
      },
  html: string,
  serverConfig: { serverBaseUrl: string; cspUrls: string[] },
  isDev: boolean = false
): {
  name: string;
  title: string;
  description: string;
  type: "appsSdk" | "mcpApps";
  props: import("../types/resource.js").WidgetProps;
  _meta: Record<string, unknown>;
  htmlTemplate: string;
  appsSdkMetadata?: Record<string, any>;
  metadata?: Record<string, any>;
} {
  // Use props field (preferred) with fallback to inputs/schema for backward compatibility
  const props = (metadata.props ||
    metadata.inputs ||
    metadata.schema ||
    {}) as import("../types/resource.js").WidgetProps;
  const description =
    (metadata.description as string | undefined) || `Widget: ${widgetName}`;
  const title = (metadata.title as string | undefined) || widgetName;
  // Extract exposeAsTool flag (defaults to false — use exposeAsTool: true to opt in)
  const exposeAsTool =
    metadata.exposeAsTool !== undefined ? metadata.exposeAsTool : false;

  // Auto-detect widget type based on metadata presence:
  // - Default → mcpApps (dual-protocol for both ChatGPT and MCP Apps clients)
  // - If only `appsSdkMetadata` is present → appsSdk (legacy ChatGPT-only)
  const widgetType =
    metadata.appsSdkMetadata && !metadata.metadata ? "appsSdk" : "mcpApps";

  const mcp_connect_domain = serverConfig.serverBaseUrl
    ? new URL(serverConfig.serverBaseUrl || "").origin
    : null;

  // Get slugified name for URL routing
  const slugifiedName = slugifyWidgetName(widgetName);

  const baseRegistration = {
    name: widgetName,
    title: title as string,
    description: description as string,
    type: widgetType as "appsSdk" | "mcpApps",
    props: props as import("../types/resource.js").WidgetProps,
    _meta: {
      "mcp-use/widget": {
        name: widgetName,
        slugifiedName: slugifiedName,
        title: title,
        description: description,
        type: widgetType,
        props: props,
        html: html,
        dev: isDev,
        exposeAsTool: exposeAsTool,
      },
      ui: {},
      // mcp-use private extension: props schema for inspector PropsConfigDialog.
      // Not part of SEP-1865; other hosts will ignore this key.
      ...(props && Object.keys(props).length > 0
        ? { "mcp-use/propsSchema": props }
        : {}),
      ...(metadata._meta || {}),
    },
    htmlTemplate: html,
  };

  // For appsSdk type (no unified metadata), add appsSdkMetadata
  if (widgetType === "appsSdk") {
    return {
      ...baseRegistration,
      type: "appsSdk" as const,
      appsSdkMetadata: {
        "openai/widgetDescription": description,
        "openai/toolInvocation/invoking": `Loading ${widgetName}...`,
        "openai/toolInvocation/invoked": `${widgetName} ready`,
        "openai/widgetAccessible": true,
        "openai/resultCanProduceWidget": true,
        "openai/widgetDomain": "https://chatgpt.com", // Default domain (required for app submission)
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
          // frame_domains for iframe embeds (optional per OpenAI spec)
          ...((metadata.appsSdkMetadata as any)?.["openai/widgetCSP"]
            ?.frame_domains
            ? {
                frame_domains: (metadata.appsSdkMetadata as any)?.[
                  "openai/widgetCSP"
                ]?.frame_domains as string[],
              }
            : {}),
          // redirect_domains for openExternal redirects (optional per OpenAI spec)
          ...((metadata.appsSdkMetadata as any)?.["openai/widgetCSP"]
            ?.redirect_domains
            ? {
                redirect_domains: (metadata.appsSdkMetadata as any)?.[
                  "openai/widgetCSP"
                ]?.redirect_domains as string[],
              }
            : {}),
        },
      },
    };
  } else {
    // For mcpApps type (has unified metadata), generate dual-protocol support
    return {
      ...baseRegistration,
      type: "mcpApps" as const,
      metadata: {
        description,
        invoking: `Loading ${widgetName}...`,
        invoked: `${widgetName} ready`,
        ...((metadata.metadata as Record<string, unknown> | undefined) || {}),
      },
      // Include appsSdkMetadata if provided for advanced ChatGPT features
      ...((metadata.appsSdkMetadata as Record<string, unknown> | undefined)
        ? { appsSdkMetadata: metadata.appsSdkMetadata as Record<string, any> }
        : {}),
    };
  }
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

  // Merge fields from definition._meta into the resource content _meta.
  // Per SEP-1865, content item _meta.ui must only contain: csp, prefersBorder, domain, permissions.
  // "mcp-use/widget" (internal bookkeeping with html, dev flag, etc.) is always stripped.
  // "mcp-use/propsSchema" is kept as a top-level _meta extension so the inspector can
  // render the props config dialog from the resources/read content response.
  if (definition._meta && Object.keys(definition._meta).length > 0) {
    const resourceMeta = uiResource.resource._meta ?? {};
    const defMeta = definition._meta as {
      ui?: Record<string, unknown>;
      [k: string]: unknown;
    };
    // Only include spec-compliant ui fields in content _meta.
    // scriptDirectives is kept as a practical extension used by the sandbox proxy.
    const specUiKeys = new Set([
      "csp",
      "prefersBorder",
      "domain",
      "permissions",
    ]);
    const defUiFiltered = defMeta.ui
      ? Object.fromEntries(
          Object.entries(defMeta.ui).filter(([k]) => specUiKeys.has(k))
        )
      : undefined;
    const mergedUi =
      resourceMeta.ui || defUiFiltered
        ? {
            ...((resourceMeta.ui as Record<string, unknown>) || {}),
            ...(defUiFiltered || {}),
          }
        : undefined;
    // Strip only "mcp-use/widget" (internal bookkeeping with html, slugifiedName, etc.).
    // Other mcp-use/* keys like "mcp-use/propsSchema" pass through as top-level _meta extensions.
    const defMetaPublic = Object.fromEntries(
      Object.entries(defMeta).filter(
        ([k]) => k !== "ui" && k !== "mcp-use/widget"
      )
    );
    uiResource.resource._meta = {
      ...resourceMeta,
      ...defMetaPublic,
      ...(mergedUi !== undefined ? { ui: mergedUi } : {}),
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
function ensureWidgetMetadata(
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
async function readWidgetHtml(
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
 *   './.mcp-use/widgets/kanban-board/index.html',
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

  // Inject runtime globals (no-op if already baked at build time).
  html = processWidgetHtml(html, widgetName);

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
 * Creates an HTTP route to serve files from the public/ or .mcp-use/public/ directory.
 * This function encapsulates the common pattern of serving static files.
 *
 * @param app - Hono app instance to mount routes on
 * @param useDistDirectory - Whether to serve from .mcp-use/public (production) or public (dev)
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
  // Register on the outer (root) app at `/_mcp-use/public/*` so public
  // assets are reachable at a stable, basePath-agnostic URL.
  const routePrefix = "/_mcp-use/public/";
  app.get(`${routePrefix}*`, async (c: Context) => {
    const filePath = c.req.path.split(routePrefix)[1] ?? "";
    // Production reads from `.mcp-use/public` (built output). Dev reads
    // from the user's source `public/` directory.
    const fsBase = useDistDirectory ? ".mcp-use/public" : "public";
    const fullPath = pathHelpers.join(getCwd(), fsBase, filePath);

    try {
      const content = await fsHelpers.readFile(fullPath);
      return new Response(content, {
        status: 200,
        headers: { "Content-Type": getContentType(filePath) },
      });
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
 * @param useDistDirectory - Whether to serve from .mcp-use/public (production) or public (dev)
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

  const handler = async (c: Context) => {
    const fsBase = useDistDirectory ? ".mcp-use/public" : "public";
    const fullPath = pathHelpers.join(getCwd(), fsBase, faviconPath);

    try {
      const content = await fsHelpers.readFile(fullPath);
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": getContentType(faviconPath),
          "Cache-Control": "public, max-age=31536000", // Cache for 1 year
        },
      });
    } catch {
      return c.notFound();
    }
  };

  // Register at bare /favicon.ico. Callers should pass the underlying root
  // Hono so browsers' implicit `GET /favicon.ico` resolves regardless of
  // basePath.
  app.get("/favicon.ico", handler);
}
