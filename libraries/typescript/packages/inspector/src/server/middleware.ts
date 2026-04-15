import type { Express, NextFunction, Request, Response } from "express";
import { Hono } from "hono";
import { checkClientFiles, getClientDistPath } from "./file-utils.js";
import { registerInspectorRoutes } from "./shared-routes.js";
import { registerStaticRoutes } from "./shared-static.js";

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
    /** Port the host app listens on (embedded inspector); required for tunnel start */
    serverPort?: number;
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

  // If it's already a Hono app, register routes directly.
  //
  // We detect Hono by its `.fetch(Request) => Response` method rather than
  // `app instanceof Hono`. When this package and the host (e.g. `mcp-use`)
  // resolve different copies of `hono` from `node_modules` — common when
  // multiple deps bundle their own Hono — `instanceof` returns false even
  // for a real Hono app, and the Express-compat path below runs against a
  // Hono Context, crashing on `req.headers.host`. Express apps don't expose
  // `.fetch`, so the check is unambiguous in practice.
  const looksLikeHono =
    app instanceof Hono || typeof (app as any)?.fetch === "function";
  if (looksLikeHono) {
    registerInspectorRoutes(app as Hono, config);
    registerStaticRoutes(app as Hono, clientDistPath, runtimeConfig);
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
