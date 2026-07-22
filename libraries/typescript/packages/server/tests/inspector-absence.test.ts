import { describe, expect, it } from "vitest";

import { MCPServer } from "../src/server.js";

describe("production server surface", () => {
  it("does not mount Inspector UI or proxy routes", async () => {
    const server = new MCPServer({
      name: "production-surface",
      version: "1.0.0",
    });
    const handler = server.fetch;

    for (const pathname of [
      "/mcp/inspector",
      "/mcp/inspector/api/proxy",
      "/mcp/inspector/api/oauth/metadata",
    ]) {
      const response = await handler(
        new Request(`https://server.example.test${pathname}`, {
          method: pathname.endsWith("proxy") ? "POST" : "GET",
          headers: { accept: "text/html" },
        })
      );
      expect(response.status, pathname).toBe(404);
    }
  });
});
