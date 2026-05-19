import { describe, expect, it } from "vitest";
import { MCPServer } from "../../../src/server/index.js";
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
