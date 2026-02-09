import type { Express, NextFunction, Request, Response } from "express";
import { Hono } from "hono";
import { registerInspectorRoutes } from "./shared-routes.js";
import { registerStaticRoutes } from "./shared-static.js";
import { checkClientFiles, getClientDistPath } from "./file-utils.js";

/**
 * Mount the MCP Inspector UI at a specified path on an Express or Hono app
 * Similar to how FastAPI mounts Swagger UI at /docs
 *
 * @param app - Express or Hono application instance
 * @param config - Optional configuration including autoConnectUrl
 *
 * @example
 * ```typescript
 * import { MCPServer } from 'mcp-use/server'
 * import { mountInspector } from '@mcp-use/inspector'
 *
 * const server = new MCPServer({ name: 'my-server', version: '1.0.0' })
 * mountInspector(server) // Mounts at /inspector
 * mountInspector(server, { autoConnectUrl: 'http://localhost:3000/mcp' }) // With auto-connect
 * ```
 */
export function mountInspector(
  app: Express | Hono,
  config?: {
    autoConnectUrl?: string | null;
    /** Whether the server is running in development mode (enables same-origin sandbox) */
    devMode?: boolean;
    /** Override the sandbox origin for MCP Apps widgets (e.g., for production reverse proxies) */
    sandboxOrigin?: string | null;
  }
): void {
  // Find the built client files
  const clientDistPath = getClientDistPath();

  if (!checkClientFiles(clientDistPath)) {
    console.warn(
      `⚠️  MCP Inspector client files not found at ${clientDistPath}`
    );
    console.warn(
      `   Run 'yarn build' in the inspector package to build the UI`
    );
  }

  // Build runtime config to inject into the HTML
  const runtimeConfig = {
    devMode: config?.devMode,
    sandboxOrigin: config?.sandboxOrigin,
  };

  // If it's already a Hono app, register routes directly
  if (app instanceof Hono) {
    registerInspectorRoutes(app, config);
    registerStaticRoutes(app, clientDistPath, runtimeConfig);
    return;
  }

  // For Express apps, create a Hono app and bridge the requests
  const honoApp = new Hono();

  // Register routes on Hono app
  registerInspectorRoutes(honoApp, config);
  registerStaticRoutes(honoApp, clientDistPath, runtimeConfig);

  // Convert all Hono routes to Express middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Use Hono's fetch API
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
    });

    Promise.resolve(honoApp.fetch(request))
      .then(async (fetchResponse: globalThis.Response) => {
        // Set status
        res.status(fetchResponse.status);

        // Copy headers
        fetchResponse.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value);
        });

        // Send body
        if (fetchResponse.body) {
          const reader = fetchResponse.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            res.write(value);
          }
          res.end();
        } else {
          res.end();
        }
      })
      .catch(next);
  });
}
