/**
 * Server Lifecycle Utilities
 *
 * Runtime-aware helpers for server startup, path rewriting, and CORS handling.
 */

import type { Hono as HonoType } from "hono";
import { getEnv, isDeno } from "./runtime.js";

export function isProductionMode(): boolean {
  // Only check NODE_ENV - CLI commands set this explicitly
  // 'mcp-use dev' sets NODE_ENV=development
  // 'mcp-use start' sets NODE_ENV=production
  return getEnv("NODE_ENV") === "production";
}

/**
 * Get Deno-specific CORS headers
 *
 * @returns CORS headers object for Deno responses
 */
export function getDenoCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

/**
 * Apply CORS headers to a response
 *
 * @param response - The response to add CORS headers to
 * @returns New response with CORS headers applied
 */
export function applyDenoCorsHeaders(response: Response): Response {
  const corsHeaders = getDenoCorsHeaders();
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Create a Supabase path rewriter function
 *
 * Supabase includes the function name in the path (e.g., /functions/v1/mcp-server/mcp or /mcp-server/mcp)
 * This function strips the function name prefix to get the actual route path.
 *
 * @returns Function that rewrites Supabase paths to actual route paths
 */
export function createSupabasePathRewriter(): (pathname: string) => string {
  return (pathname: string): string => {
    let newPathname = pathname;

    // Match /functions/v1/{anything}/... and strip up to the function name
    const functionsMatch = pathname.match(/^\/functions\/v1\/[^/]+(\/.*)?$/);
    if (functionsMatch) {
      newPathname = functionsMatch[1] || "/";
    } else {
      // Match /{function-name}/... pattern
      const functionNameMatch = pathname.match(/^\/([^/]+)(\/.*)?$/);
      if (functionNameMatch && functionNameMatch[2]) {
        newPathname = functionNameMatch[2] || "/";
      }
    }

    return newPathname;
  };
}

/**
 * Rewrite request path for Supabase environment
 *
 * @param req - The original request
 * @returns New request with rewritten path if needed
 */
export function rewriteSupabaseRequest(req: Request): Request {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const rewriter = createSupabasePathRewriter();
  const newPathname = rewriter(pathname);

  // Only create new request if path changed
  if (newPathname !== pathname) {
    const newUrl = new URL(newPathname + url.search, url.origin);
    return new Request(newUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: req.redirect,
    });
  }

  return req;
}

/**
 * Start the server based on runtime environment
 *
 * @param app - Hono application instance
 * @param port - Port number to listen on
 * @param host - Hostname to bind to
 * @param options - Additional options for server startup
 * @param options.onDenoRequest - Optional callback to transform requests in Deno (e.g., for path rewriting)
 * @param options.onDenoResponse - Optional callback to transform responses in Deno (e.g., for CORS)
 * @returns Promise that resolves when server is started
 */
export async function startServer(
  app: HonoType,
  port: number,
  host: string,
  options?: {
    onDenoRequest?: (req: Request) => Request | Promise<Request>;
    onDenoResponse?: (res: Response) => Response | Promise<Response>;
  }
): Promise<void> {
  if (isDeno) {
    // Deno runtime
    const corsHeaders = getDenoCorsHeaders();

    (globalThis as any).Deno.serve(
      { port, hostname: host },
      async (req: Request) => {
        // Handle CORS preflight requests
        if (req.method === "OPTIONS") {
          return new Response("ok", { headers: corsHeaders });
        }

        // Apply request transformation if provided
        let finalReq = req;
        if (options?.onDenoRequest) {
          finalReq = await options.onDenoRequest(req);
        }

        // Call the app handler
        let response = await app.fetch(finalReq);

        // Apply response transformation if provided
        if (options?.onDenoResponse) {
          response = await options.onDenoResponse(response);
        } else {
          // Default: apply CORS headers
          response = applyDenoCorsHeaders(response);
        }

        return response;
      }
    );
    console.log(`[SERVER] Listening`);
  } else {
    // Node.js runtime
    const { serve } = await import("@hono/node-server");
    serve(
      {
        fetch: app.fetch,
        port,
        hostname: host,
      },
      (_info: any) => {
        console.log(`[SERVER] Listening on http://${host}:${port}`);
        console.log(`[MCP] Endpoints: http://${host}:${port}/mcp`);
      }
    );
  }
}
