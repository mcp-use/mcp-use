/**
 * OpenAPI-to-MCP bridge routes.
 *
 * Provides endpoints to start/stop ephemeral MCP servers that are
 * automatically generated from pasted OpenAPI JSON specs.
 */

import type { Hono } from "hono";
import { createServer } from "node:net";

interface RunningBridge {
  mcpUrl: string;
  port: number;
  serverName: string;
}

const runningBridges = new Map<string, RunningBridge>();

/** Find a free port by briefly binding to port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine port")));
      }
    });
    server.on("error", reject);
  });
}

export function registerOpenApiRoutes(app: Hono) {
  /**
   * POST /inspector/api/openapi/start
   *
   * Body: { spec: object | string }
   *   - spec: The OpenAPI JSON document (object, JSON string, or URL to fetch)
   *
   * Response: { id: string, mcpUrl: string, port: number, serverName: string, toolCount: number }
   */
  app.post("/inspector/api/openapi/start", async (c) => {
    try {
      const body = await c.req.json();
      let spec = body.spec;

      if (!spec) {
        return c.json({ error: "Missing 'spec' field in request body" }, 400);
      }

      // If spec is a string, it could be a URL or JSON
      if (typeof spec === "string") {
        const trimmed = spec.trim();

        // Detect URLs (http://, https://, or looks like a domain)
        if (
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://")
        ) {
          try {
            console.log(
              `[OpenAPI Bridge] Fetching spec from URL: ${trimmed}`
            );
            const response = await fetch(trimmed, {
              headers: { Accept: "application/json" },
            });
            if (!response.ok) {
              return c.json(
                {
                  error: `Failed to fetch OpenAPI spec from URL: ${response.status} ${response.statusText}`,
                },
                400
              );
            }
            spec = await response.json();
          } catch (err: any) {
            return c.json(
              {
                error: `Failed to fetch OpenAPI spec from URL: ${err.message || "Network error"}`,
              },
              400
            );
          }
        } else {
          // Try to parse as JSON
          try {
            spec = JSON.parse(trimmed);
          } catch {
            return c.json(
              {
                error:
                  "Input is not a valid URL or JSON. Provide either a URL to an OpenAPI spec or the raw JSON.",
              },
              400
            );
          }
        }
      }

      // Basic validation
      if (!spec.openapi && !spec.swagger) {
        return c.json(
          {
            error:
              "The provided JSON does not appear to be an OpenAPI spec (missing 'openapi' or 'swagger' field)",
          },
          400
        );
      }

      // Find a free port
      const port = await findFreePort();
      const id = `openapi-${Date.now()}-${port}`;

      // Compile and validate the spec first
      const { compileOpenApiSpec } = await import("../openapi-to-mcp.js");
      const { tools } = compileOpenApiSpec(spec);

      if (tools.length === 0) {
        return c.json(
          {
            error:
              "No valid operations found in the OpenAPI spec. Ensure the spec has paths with supported HTTP methods and JSON request/response types.",
          },
          400
        );
      }

      // Start the MCP server in-process
      const { startOpenApiMcpServer } = await import("../openapi-to-mcp.js");
      const result = await startOpenApiMcpServer(spec, port);

      runningBridges.set(id, {
        mcpUrl: result.mcpUrl,
        port,
        serverName: result.serverName,
      });

      console.log(
        `[OpenAPI Bridge] Started "${result.serverName}" on port ${port} with ${tools.length} tools`
      );

      return c.json({
        id,
        mcpUrl: result.mcpUrl,
        port,
        serverName: result.serverName,
        toolCount: tools.length,
      });
    } catch (error) {
      console.error("[OpenAPI Bridge] Error starting bridge:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

  /**
   * GET /inspector/api/openapi/list
   *
   * Returns all running OpenAPI bridge servers.
   */
  app.get("/inspector/api/openapi/list", (c) => {
    const bridges = Array.from(runningBridges.entries()).map(
      ([id, bridge]) => ({
        id,
        mcpUrl: bridge.mcpUrl,
        port: bridge.port,
        serverName: bridge.serverName,
      })
    );
    return c.json({ bridges });
  });
}
