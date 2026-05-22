import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCPServer, oauthSupabaseProvider } from "../../../src/server/index.js";

describe("MCPServer basePath", () => {
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

    it("mounts framework-internal assets under basePath at `${basePath}/_mcp-use/*`", async () => {
      const server = new MCPServer({
        name: "internal-assets-base-path",
        version: "1.0.0",
        basePath: "/api",
      });

      const handler = await server.getHandler();

      // Unprefixed `/_mcp-use/*` no longer resolves — the framework
      // namespace is mounted under the configured basePath.
      const root = await handler(
        new Request("http://localhost/_mcp-use/public/missing.png")
      );
      expect(root.status).toBe(404);

      // Prefixed path: 404 for a missing file is the expected production
      // result (the route exists, the file doesn't).
      const prefixed = await handler(
        new Request("http://localhost/api/_mcp-use/public/missing.png")
      );
      expect(prefixed.status).toBe(404);

      // The legacy `/__mcp-use/serverinfo` HTTP endpoint is gone; the same
      // information now lives in `.mcp-use/server-info.json` after listen().
      const removed = await handler(
        new Request("http://localhost/__mcp-use/serverinfo")
      );
      expect(removed.status).toBe(404);
    });

    describe("static serving from .mcp-use/", () => {
      const fixturesDir = join(process.cwd(), ".mcp-use");
      let originalNodeEnv: string | undefined;

      beforeAll(async () => {
        // serveStatic only mounts when NODE_ENV=production (see
        // widgets/index.ts:86). Force prod for this block; restore after.
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        await mkdir(join(fixturesDir, "widgets", "sample"), { recursive: true });
        await mkdir(join(fixturesDir, "widgets", "sample", "assets"), {
          recursive: true,
        });
        await mkdir(join(fixturesDir, "public"), { recursive: true });
        await writeFile(
          join(fixturesDir, "widgets", "sample", "index.html"),
          `<!doctype html><html><head><script>window.__mcpPublicUrl="/_mcp-use/public";</script></head><body>sample</body></html>`,
          "utf8"
        );
        await writeFile(
          join(fixturesDir, "widgets", "sample", "assets", "entry.js"),
          `console.log("hi");`,
          "utf8"
        );
        await writeFile(
          join(fixturesDir, "public", "hello.txt"),
          "hello world",
          "utf8"
        );
      });

      afterAll(async () => {
        process.env.NODE_ENV = originalNodeEnv;
        // Remove only the fixtures we created — leave anything else under
        // .mcp-use/ alone (e.g. real generated files from other tests).
        await rm(join(fixturesDir, "widgets", "sample"), {
          recursive: true,
          force: true,
        });
        await rm(join(fixturesDir, "public", "hello.txt"), { force: true });
      });

      it("serves widget HTML byte-for-byte from disk under basePath", async () => {
        const server = new MCPServer({
          name: "static-widget-html",
          version: "1.0.0",
          basePath: "/api",
        });

        const handler = await server.getHandler();
        const res = await handler(
          new Request(
            "http://localhost/api/_mcp-use/widgets/sample/index.html"
          )
        );

        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('window.__mcpPublicUrl="/_mcp-use/public"');
        expect(body).toContain("<body>sample</body>");
      });

      it("serves widget JS assets with correct content-type", async () => {
        const server = new MCPServer({
          name: "static-widget-assets",
          version: "1.0.0",
        });

        const handler = await server.getHandler();
        const res = await handler(
          new Request(
            "http://localhost/_mcp-use/widgets/sample/assets/entry.js"
          )
        );

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/javascript/);
        expect(await res.text()).toBe(`console.log("hi");`);
      });

      it("serves public files from .mcp-use/public/ under basePath", async () => {
        const server = new MCPServer({
          name: "static-public",
          version: "1.0.0",
          basePath: "/api",
        });

        const handler = await server.getHandler();
        const res = await handler(
          new Request("http://localhost/api/_mcp-use/public/hello.txt")
        );

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hello world");
      });
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
});
