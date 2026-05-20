import { describe, expect, it } from "vitest";
import { MCPServer, oauthSupabaseProvider } from "../../../src/server/index.js";
import { normalizeBasePath } from "../../../src/server/utils/server-helpers.js";

describe("MCPServer basePath", () => {
  describe("normalizeBasePath", () => {
    it("returns empty string for undefined / empty / '/'", () => {
      expect(normalizeBasePath(undefined)).toBe("");
      expect(normalizeBasePath("")).toBe("");
      expect(normalizeBasePath("/")).toBe("");
    });

    it("strips trailing slashes", () => {
      expect(normalizeBasePath("/api/")).toBe("/api");
      expect(normalizeBasePath("/api///")).toBe("/api");
    });

    it("preserves nested paths", () => {
      expect(normalizeBasePath("/a/b/c")).toBe("/a/b/c");
    });

    it("throws when the prefix is missing the leading slash", () => {
      expect(() => normalizeBasePath("api")).toThrow(/must start with/);
    });
  });

  describe("route mounting", () => {
    it("mounts MCP transport at the configured basePath and 404s the root", async () => {
      const server = new MCPServer({
        name: "base-path-test",
        version: "1.0.0",
        basePath: "/api",
      });

      const handler = await server.getHandler();

      const prefixed = await handler(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "test", version: "1.0.0" },
            },
          }),
        })
      );
      // 200 means the transport accepted and handled the initialize request.
      expect(prefixed.status).toBe(200);

      const root = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "test", version: "1.0.0" },
            },
          }),
        })
      );
      expect(root.status).toBe(404);
    });

    it("mounts MCP transport at /mcp when no basePath is set (back-compat)", async () => {
      const server = new MCPServer({
        name: "base-path-default",
        version: "1.0.0",
      });

      const handler = await server.getHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "test", version: "1.0.0" },
            },
          }),
        })
      );

      expect(response.status).toBe(200);
    });

    it("auto-prefixes user-registered routes under basePath", async () => {
      const server = new MCPServer({
        name: "user-route-prefix",
        version: "1.0.0",
        basePath: "/api",
      });

      // User registers a custom route on `server.app`. With basePath set,
      // this should be reachable at `${basePath}/health`, not at `/health`.
      server.app.get("/health", (c) => c.text("ok"));

      const handler = await server.getHandler();

      const prefixed = await handler(
        new Request("http://localhost/api/health")
      );
      expect(prefixed.status).toBe(200);
      expect(await prefixed.text()).toBe("ok");

      const root = await handler(new Request("http://localhost/health"));
      expect(root.status).toBe(404);
    });

    it("mounts framework-internal assets at /_mcp-use/ regardless of basePath", async () => {
      const server = new MCPServer({
        name: "internal-assets-base-path",
        version: "1.0.0",
        basePath: "/api",
      });

      const handler = await server.getHandler();

      // `_mcp-use/*` is basePath-agnostic — a missing widget still returns
      // 404 rather than falling through to the inner sub-mount.
      const internal = await handler(
        new Request("http://localhost/_mcp-use/public/missing.png")
      );
      expect(internal.status).toBe(404);

      // The legacy `/__mcp-use/serverinfo` HTTP endpoint is gone; the same
      // information now lives in `.mcp-use/server-info.json` after listen().
      const removed = await handler(
        new Request("http://localhost/__mcp-use/serverinfo")
      );
      expect(removed.status).toBe(404);
    });

    it("serves OAuth discovery at root and path-aware paths (basePath-agnostic)", async () => {
      const server = new MCPServer({
        name: "oauth-discovery-base-path",
        version: "1.0.0",
        basePath: "/api",
        baseUrl: "http://localhost:3000",
        oauth: oauthSupabaseProvider({ projectId: "abc123" }),
      });

      const handler = await server.getHandler();

      // 1. Root-level RFC 9728 protected resource metadata (SDK fallback)
      const root = await handler(
        new Request(
          "http://localhost:3000/.well-known/oauth-protected-resource"
        )
      );
      expect(root.status).toBe(200);
      const rootBody = (await root.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(rootBody.resource).toBe("http://localhost:3000/api");
      expect(rootBody.authorization_servers).toEqual([
        "https://abc123.supabase.co/auth/v1",
      ]);

      // 2. Path-scoped RFC 9728: <host>/.well-known/oauth-protected-resource/api/mcp
      //    (what the SDK's `discoverMetadataWithFallback` probes first)
      const scoped = await handler(
        new Request(
          "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"
        )
      );
      expect(scoped.status).toBe(200);
      const scopedBody = (await scoped.json()) as { resource: string };
      expect(scopedBody.resource).toBe("http://localhost:3000/api/mcp");

      // 3. Root RFC 8414 authorization server metadata route is mounted
      //    (DCR-direct mode proxies upstream — we just assert the route
      //    exists, not the body, since upstream is network-dependent).
      const authMeta = await handler(
        new Request(
          "http://localhost:3000/.well-known/oauth-authorization-server"
        )
      );
      expect(authMeta.status).not.toBe(404);

      // 4. Path-aware RFC 8414: <host>/.well-known/oauth-authorization-server/api
      const authMetaPath = await handler(
        new Request(
          "http://localhost:3000/.well-known/oauth-authorization-server/api"
        )
      );
      expect(authMetaPath.status).not.toBe(404);

      // 5. /token stays under basePath. Root /token must 404 — that's the
      //    bug class this restructure prevents for embedded apps where
      //    arbitrary host routes would otherwise collide.
      const rootToken = await handler(
        new Request("http://localhost:3000/token", { method: "POST" })
      );
      expect(rootToken.status).toBe(404);
    });
  });

  describe("instance state", () => {
    it("exposes the normalized basePath as a public field", () => {
      const server = new MCPServer({
        name: "base-path-field",
        version: "1.0.0",
        basePath: "/api/",
      });

      expect(server.basePath).toBe("/api");
    });

    it("defaults basePath to empty string", () => {
      const server = new MCPServer({
        name: "base-path-empty",
        version: "1.0.0",
      });
      expect(server.basePath).toBe("");
    });
  });
});
