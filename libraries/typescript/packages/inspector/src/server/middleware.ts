import type { Express, NextFunction, Request, Response } from "express";
import { Hono } from "hono";
import {
  registerInspectorCdnShell,
  type InspectorMode,
} from "./cdn-shell.js";
import {
  registerInspectorProxyRoutes,
  type InspectorProxyRoutesConfig,
} from "./proxy-routes.js";

/**
 * Mount the MCP Inspector UI at a specified path on an Express or Hono app
 * Similar to how FastAPI mounts Swagger UI at /docs
 *
 * @param app - Express or Hono application instance
 * @param config - Optional configuration including autoConnectUrl
 *
 * @example
 * ```typescript
 * import { MCPServer } from 'mcp-use'
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
    /** Explicit cross-origin callers of the OAuth BFF. Same-origin is implicit. */
    oauthProxyAllowedOrigins?: readonly string[];
    /** Allow OAuth discovery against loopback targets. Use only for local development. */
    oauthProxyAllowLoopback?: boolean;
    /**
     * Normalized server-wide path prefix the embedding server mounts its whole
     * framework surface under (default `/mcp`; `""` = root). The inspector
     * relocates to `${basePath}/inspector` and its proxy/API live under
     * `${basePath}/inspector/api/*`. Injected into the client HTML as
     * `window.__MCP_BASE_PATH__` so the client can derive its own URLs.
     */
    basePath?: string;
  }
): void {
  const basePath = normalizeInspectorBasePath(config?.basePath);
  const routesConfig: InspectorProxyRoutesConfig = {
    autoConnectUrl: config?.autoConnectUrl,
    oauthProxyAllowedOrigins: config?.oauthProxyAllowedOrigins ?? [],
    oauthProxyAllowLoopback:
      config?.oauthProxyAllowLoopback ?? config?.devMode === true,
  };

  const shellConfig = {
    devMode: config?.devMode,
    sandboxOrigin: config?.sandboxOrigin,
    inspectorMode: "embedded" as InspectorMode,
    basePath,
    proxyUrl: `${basePath}/inspector/api/proxy`,
  };

  if (isHonoApp(app)) {
    registerInspectorProxyRoutes(app, routesConfig, basePath);
    registerInspectorCdnShell(app, shellConfig, basePath);
    return;
  }

  const honoApp = new Hono();
  registerInspectorProxyRoutes(honoApp, routesConfig, basePath);
  registerInspectorCdnShell(honoApp, shellConfig, basePath);

  app.use((req: Request, res: Response, next: NextFunction) => {
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
        res.status(fetchResponse.status);
        fetchResponse.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value);
        });

        if (fetchResponse.body) {
          const reader = fetchResponse.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
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

function isHonoApp(app: Express | Hono): app is Hono {
  return typeof (app as { fetch?: unknown }).fetch === "function";
}

function normalizeInspectorBasePath(raw: string | undefined): string {
  if (raw === undefined) return "/mcp";
  let value = raw
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}
