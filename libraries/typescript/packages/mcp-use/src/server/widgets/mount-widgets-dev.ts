/**
 * Development mode widget mounting with Vite HMR
 *
 * This module handles serving widgets from the resources/ directory in development mode
 * with hot module replacement (HMR) support. It uses Vite to transform and serve
 * React/TSX widget files with live reloading during development.
 */

import type { Hono as HonoType, Context, Next } from "hono";
import { adaptConnectMiddleware } from "../connect-adapter.js";
import type { WidgetMetadata } from "../types/widget.js";
import { pathHelpers, getCwd } from "../utils/runtime.js";
import {
  setupPublicRoutes,
  setupFaviconRoute,
  registerWidgetFromTemplate,
} from "./widget-helpers.js";
import type {
  ServerConfig,
  MountWidgetsOptions,
  RegisterWidgetCallback,
} from "./widget-types.js";

const TMP_MCP_USE_DIR = ".mcp-use";

/**
 * Configuration for development widget mounting
 */
export type MountWidgetsDevOptions = MountWidgetsOptions;

/**
 * Mounts local widget sources under the project's resources directory into a shared Vite dev server with HMR so they can be served and inspected during development.
 *
 * Discovers top-level `.tsx`/`.ts` widget files and folders containing `widget.tsx`, generates per-widget temporary entry and HTML files under `.mcp-use`, starts a single Vite middleware server that watches the resources directory for changes, and registers each widget via the provided callback for MCP-UI compatibility.
 *
 * @param app - Hono application instance to mount middleware and routes onto
 * @param serverConfig - Server configuration (base URL, port, CSP, favicon, etc.) used to configure routes and Vite origin
 * @param registerWidget - Callback invoked to register each discovered widget with the running server
 * @param options - Optional overrides: `baseRoute` to change the mount path (default: `/mcp-use/widgets`) and `resourcesDir` to change the scanned resources directory (default: `resources`)
 * @returns Nothing.
 */
export async function mountWidgetsDev(
  app: HonoType,
  serverConfig: ServerConfig,
  registerWidget: RegisterWidgetCallback,
  options?: MountWidgetsDevOptions
): Promise<void> {
  const { promises: fs } = await import("node:fs");
  const baseRoute = options?.baseRoute || "/mcp-use/widgets";
  const resourcesDir = options?.resourcesDir || "resources";
  const srcDir = pathHelpers.join(getCwd(), resourcesDir);

  // Check if resources directory exists
  try {
    await fs.access(srcDir);
  } catch (error) {
    console.log(
      `[WIDGETS] No ${resourcesDir}/ directory found - skipping widget serving`
    );
    return;
  }

  // Find all TSX widget files and folders with widget.tsx
  const entries: Array<{ name: string; path: string }> = [];
  try {
    const files = await fs.readdir(srcDir, { withFileTypes: true });
    for (const dirent of files) {
      // Exclude macOS resource fork files and other hidden/system files
      if (dirent.name.startsWith("._") || dirent.name.startsWith(".DS_Store")) {
        continue;
      }

      if (
        dirent.isFile() &&
        (dirent.name.endsWith(".tsx") || dirent.name.endsWith(".ts"))
      ) {
        // Single file widget
        entries.push({
          name: dirent.name.replace(/\.tsx?$/, ""),
          path: pathHelpers.join(srcDir, dirent.name),
        });
      } else if (dirent.isDirectory()) {
        // Check for widget.tsx in folder
        const widgetPath = pathHelpers.join(srcDir, dirent.name, "widget.tsx");
        try {
          await fs.access(widgetPath);
          entries.push({
            name: dirent.name,
            path: widgetPath,
          });
        } catch {
          // widget.tsx doesn't exist in this folder, skip it
        }
      }
    }
  } catch (error) {
    console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`);
    return;
  }

  if (entries.length === 0) {
    console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`);
    return;
  }

  // Create a temp directory for widget entry files
  const tempDir = pathHelpers.join(getCwd(), TMP_MCP_USE_DIR);

  // Clean up stale widget directories in .mcp-use
  try {
    // Check if .mcp-use exists
    await fs.access(tempDir);

    // Get list of current widget names
    const currentWidgetNames = new Set(entries.map((e) => e.name));

    // Read existing directories in .mcp-use
    const existingDirs = await fs.readdir(tempDir, { withFileTypes: true });

    // Remove directories that are not in current widgets
    for (const dirent of existingDirs) {
      if (dirent.isDirectory() && !currentWidgetNames.has(dirent.name)) {
        const staleDir = pathHelpers.join(tempDir, dirent.name);
        await fs.rm(staleDir, { recursive: true, force: true });
        console.log(`[WIDGETS] Cleaned up stale widget: ${dirent.name}`);
      }
    }
  } catch {
    // .mcp-use doesn't exist yet, no cleanup needed
  }

  await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

  // Import dev dependencies - these are optional and only needed for dev mode
  // Using dynamic imports with createRequire to resolve from user's project directory
  let createServer: any;
  let react: any;
  let tailwindcss: any;

  try {
    // Use createRequire to resolve modules from the user's project directory (getCwd())
    // instead of from the mcp-use package location
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");

    // Create a require function that resolves from the user's project directory
    const userProjectRequire = createRequire(
      pathToFileURL(pathHelpers.join(getCwd(), "package.json")).href
    );

    // Resolve the actual module paths from the user's project
    const vitePath = userProjectRequire.resolve("vite");
    const reactPluginPath = userProjectRequire.resolve("@vitejs/plugin-react");
    const tailwindPath = userProjectRequire.resolve("@tailwindcss/vite");

    // Now import using the resolved paths
    const viteModule = await import(vitePath);
    createServer = viteModule.createServer;
    const reactModule = await import(reactPluginPath);
    react = reactModule.default;
    const tailwindModule = await import(tailwindPath);
    tailwindcss = tailwindModule.default;
  } catch (error) {
    throw new Error(
      "❌ Widget dependencies not installed!\n\n" +
        "To use MCP widgets with resources folder, you need to install the required dependencies:\n\n" +
        "  npm install vite @vitejs/plugin-react @tailwindcss/vite\n" +
        "  # or\n" +
        "  pnpm add vite @vitejs/plugin-react @tailwindcss/vite\n\n" +
        "These dependencies are automatically included in projects created with 'create-mcp-use-app'.\n" +
        "For production, pre-build your widgets using 'mcp-use build'."
    );
  }

  const widgets = entries.map((entry) => {
    return {
      name: entry.name,
      description: `Widget: ${entry.name}`,
      entry: entry.path,
    };
  });

  // Create entry files for each widget
  for (const widget of widgets) {
    // Create temp entry and HTML files for this widget
    const widgetTempDir = pathHelpers.join(tempDir, widget.name);
    await fs.mkdir(widgetTempDir, { recursive: true });

    // Create a CSS file with Tailwind and @source directives to scan resources
    const resourcesPath = pathHelpers.join(getCwd(), resourcesDir);
    const relativeResourcesPath = pathHelpers
      .relative(widgetTempDir, resourcesPath)
      .replace(/\\/g, "/");

    // Calculate relative path to mcp-use package dynamically
    const mcpUsePath = pathHelpers.join(getCwd(), "node_modules", "mcp-use");
    const relativeMcpUsePath = pathHelpers
      .relative(widgetTempDir, mcpUsePath)
      .replace(/\\/g, "/");

    const cssContent = `@import "tailwindcss";

/* Configure Tailwind to scan the resources directory and mcp-use package */
@source "${relativeResourcesPath}";
@source "${relativeMcpUsePath}/**/*.{ts,tsx,js,jsx}";
`;
    await fs.writeFile(
      pathHelpers.join(widgetTempDir, "styles.css"),
      cssContent,
      "utf8"
    );

    const entryContent = `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Component from '${widget.entry}'

const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component />)
}
`;

    const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${widget.name} Widget</title>${
      serverConfig.favicon
        ? `
    <link rel="icon" href="/mcp-use/public/${serverConfig.favicon}" />`
        : ""
    }
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="${baseRoute}/${widget.name}/entry.tsx"></script>
  </body>
</html>`;

    await fs.writeFile(
      pathHelpers.join(widgetTempDir, "entry.tsx"),
      entryContent,
      "utf8"
    );
    await fs.writeFile(
      pathHelpers.join(widgetTempDir, "index.html"),
      htmlContent,
      "utf8"
    );
  }

  // Build the server origin URL
  const serverOrigin = serverConfig.serverBaseUrl;

  // Create a single shared Vite dev server for all widgets
  console.log(
    `[WIDGETS] Serving ${entries.length} widget(s) with shared Vite dev server and HMR`
  );

  // Create a plugin to handle CSS imports in SSR only
  const ssrCssPlugin = {
    name: "ssr-css-handler",
    enforce: "pre" as const,
    resolveId(
      id: string,
      importer: string | undefined,
      options?: { ssr?: boolean }
    ) {
      // Only intercept CSS in SSR mode - be very explicit about this
      if (
        options &&
        options.ssr === true &&
        (id.endsWith(".css") || id.endsWith(".module.css"))
      ) {
        return "\0ssr-css:" + id;
      }
      // Don't interfere with normal resolution
      return null;
    },
    load(id: string, options?: { ssr?: boolean }) {
      // Only return empty export for CSS files in SSR mode
      if (options && options.ssr === true && id.startsWith("\0ssr-css:")) {
        return "export default {}";
      }
      // Don't interfere with normal loading
      return null;
    },
  };

  // Create a plugin to ensure Vite watches the resources directory for HMR
  const watchResourcesPlugin = {
    name: "watch-resources",
    configureServer(server: any) {
      // Explicitly add the resources directory to Vite's watch list
      // This ensures HMR works when widget source files change
      const resourcesPath = pathHelpers.join(getCwd(), resourcesDir);
      server.watcher.add(resourcesPath);
      console.log(`[WIDGETS] Watching resources directory: ${resourcesPath}`);

      // Watch for file deletions and clean up corresponding .mcp-use directories
      server.watcher.on("unlink", async (filePath: string) => {
        // Check if the deleted file is a widget file
        const relativePath = pathHelpers.relative(resourcesPath, filePath);

        // Single file widget (e.g., widget-name.tsx)
        if (
          (relativePath.endsWith(".tsx") || relativePath.endsWith(".ts")) &&
          !relativePath.includes("/")
        ) {
          const widgetName = relativePath.replace(/\.tsx?$/, "");
          const widgetDir = pathHelpers.join(tempDir, widgetName);

          try {
            await fs.access(widgetDir);
            await fs.rm(widgetDir, { recursive: true, force: true });
            console.log(
              `[WIDGETS] Cleaned up stale widget (file removed): ${widgetName}`
            );
          } catch {
            // Widget directory doesn't exist, nothing to clean up
          }
        }
        // Folder-based widget (e.g., widget-name/widget.tsx)
        else if (relativePath.endsWith("widget.tsx")) {
          const parts = relativePath.split("/");
          if (parts.length === 2) {
            const widgetName = parts[0];
            const widgetDir = pathHelpers.join(tempDir, widgetName);

            try {
              await fs.access(widgetDir);
              await fs.rm(widgetDir, { recursive: true, force: true });
              console.log(
                `[WIDGETS] Cleaned up stale widget (file removed): ${widgetName}`
              );
            } catch {
              // Widget directory doesn't exist, nothing to clean up
            }
          }
        }
      });

      // Watch for directory deletions (folder-based widgets)
      server.watcher.on("unlinkDir", async (dirPath: string) => {
        const relativePath = pathHelpers.relative(resourcesPath, dirPath);

        // Check if this is a top-level directory in resources/
        if (relativePath && !relativePath.includes("/")) {
          const widgetName = relativePath;
          const widgetDir = pathHelpers.join(tempDir, widgetName);

          try {
            await fs.access(widgetDir);
            await fs.rm(widgetDir, { recursive: true, force: true });
            console.log(
              `[WIDGETS] Cleaned up stale widget (directory removed): ${widgetName}`
            );
          } catch {
            // Widget directory doesn't exist, nothing to clean up
          }
        }
      });
    },
  };

  // Create a plugin to provide browser stubs for Node.js-only packages
  // posthog-node is server-side telemetry that can't run in browser
  const nodeStubsPlugin = {
    name: "node-stubs",
    enforce: "pre" as const,
    resolveId(id: string) {
      // Stub posthog-node and its subpaths for browser
      if (id === "posthog-node" || id.startsWith("posthog-node/")) {
        return "\0virtual:posthog-node-stub";
      }
      return null;
    },
    load(id: string) {
      if (id === "\0virtual:posthog-node-stub") {
        // Return a browser-compatible stub that mimics posthog-node API
        return `
export class PostHog {
  constructor() {}
  capture() {}
  identify() {}
  alias() {}
  flush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}
export default PostHog;
`;
      }
      return null;
    },
  };

  const viteServer = await createServer({
    root: tempDir,
    base: baseRoute + "/",
    plugins: [
      nodeStubsPlugin,
      ssrCssPlugin,
      watchResourcesPlugin,
      tailwindcss(),
      react(),
    ],
    resolve: {
      alias: {
        "@": pathHelpers.join(getCwd(), resourcesDir),
      },
    },
    server: {
      middlewareMode: true,
      origin: serverOrigin,
      hmr: {
        // Explicitly configure HMR for better cross-platform support
        protocol: "ws",
      },
      watch: {
        // Watch the resources directory for HMR to work
        // This ensures changes to widget source files trigger hot reload
        ignored: ["**/node_modules/**", "**/.git/**"],
        // Enable polling on Linux where file watching may not work reliably
        // (especially in Docker, WSL, VMs, or network filesystems)
        usePolling: process.platform === "linux",
        // If polling is enabled, check every 100ms (reasonable default)
        interval: 100,
      },
    },
    // Explicitly tell Vite to watch files outside root
    // This is needed because widget entry files import from resources directory
    optimizeDeps: {
      // Exclude Node.js-only packages from browser bundling
      // posthog-node is for server-side telemetry and doesn't work in browser
      exclude: ["posthog-node"],
    },
    ssr: {
      // Force Vite to transform these packages in SSR instead of using external requires
      noExternal: ["@openai/apps-sdk-ui", "react-router"],
      // Mark Node.js-only packages as external in SSR mode
      external: ["posthog-node"],
    },
    define: {
      // Define process.env for SSR context
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV || "development"
      ),
      "import.meta.env.DEV": true,
      "import.meta.env.PROD": false,
      "import.meta.env.MODE": JSON.stringify("development"),
      "import.meta.env.SSR": true,
    },
  });

  // Custom middleware to handle widget-specific paths
  app.use(`${baseRoute}/*`, async (c: Context, next: Next) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    const widgetMatch = pathname.replace(baseRoute, "").match(/^\/([^/]+)/);

    if (widgetMatch) {
      const widgetName = widgetMatch[1];
      const widget = widgets.find((w) => w.name === widgetName);

      if (widget) {
        // If requesting the root of a widget, serve its index.html
        const relativePath = pathname.replace(baseRoute, "");
        if (
          relativePath === `/${widgetName}` ||
          relativePath === `/${widgetName}/`
        ) {
          // Rewrite the URL for Vite by creating a new request with modified URL
          const newUrl = new URL(c.req.url);
          newUrl.pathname = `${baseRoute}/${widgetName}/index.html`;
          // Create a new request with modified URL and update the context
          const newRequest = new Request(newUrl.toString(), c.req.raw);
          // Update the request in the context by creating a new context-like object
          Object.defineProperty(c, "req", {
            value: {
              ...c.req,
              url: newUrl.toString(),
              raw: newRequest,
            },
            writable: false,
            configurable: true,
          });
        }
      }
    }

    await next();
  });

  // Mount the single Vite server for all widgets using adapter
  const viteMiddleware = await adaptConnectMiddleware(
    viteServer.middlewares,
    `${baseRoute}/*`
  );
  app.use(`${baseRoute}/*`, viteMiddleware);

  // Serve static files from public directory in dev mode
  setupPublicRoutes(app, false);

  // Setup favicon route at server root
  setupFaviconRoute(app, serverConfig.favicon, false);

  // Add a catch-all 404 handler for widget routes to prevent falling through to other middleware
  // (like the inspector) which might intercept the request and return the wrong content
  app.use(`${baseRoute}/*`, async (c: Context) => {
    const url = new URL(c.req.url);
    // Check if it's an asset request
    const isAsset = url.pathname.match(
      /\.(js|css|png|jpg|jpeg|svg|json|ico|woff2?|tsx?)$/i
    );

    // For assets or any unhandled request, return a clean 404
    // This prevents fall-through to inspector middleware
    const message = isAsset ? "Widget asset not found" : "Widget not found";
    return c.text(message, 404);
  });

  widgets.forEach((widget) => {
    console.log(
      `[WIDGET] ${widget.name} mounted at ${baseRoute}/${widget.name}`
    );
  });

  // register a tool and resource for each widget
  for (const widget of widgets) {
    // Extract metadata from the widget file using Vite SSR
    let metadata: WidgetMetadata = {};

    try {
      const mod = await viteServer.ssrLoadModule(widget.entry);
      if (mod.widgetMetadata) {
        metadata = mod.widgetMetadata;

        // Handle props field (preferred) or inputs field (deprecated) for Zod schema
        const schemaField = metadata.props || metadata.inputs;
        if (schemaField) {
          try {
            // Pass the full Zod schema object directly (don't extract .shape)
            // The SDK's normalizeObjectSchema() can handle both complete Zod schemas
            // and raw shapes, so we preserve the full schema here
            metadata.props = schemaField;
            // Also set inputs as alias for backward compatibility
            if (!metadata.inputs) {
              metadata.inputs = schemaField;
            }
          } catch (error) {
            console.warn(
              `[WIDGET] Failed to extract schema for ${widget.name}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.warn(
        `[WIDGET] Failed to load metadata for ${widget.name}:`,
        error
      );
    }

    // Use the extracted helper to register the widget
    await registerWidgetFromTemplate(
      widget.name,
      pathHelpers.join(tempDir, widget.name, "index.html"),
      (metadata.description
        ? metadata
        : { ...metadata, description: widget.description }) as Record<
        string,
        unknown
      >,
      serverConfig,
      registerWidget,
      true // isDev
    );
  }
}