import { describe, expect, it } from "vitest";
import { MCPServer } from "../../../src/server/index.js";

describe("MCPServer DNS rebinding protection", () => {
  it("allows all hosts by default when allowedOrigins is unset", async () => {
    const server = new MCPServer({
      name: "dns-default-open",
      version: "1.0.0",
    });
    server.app.get("/health", (c) => c.text("ok"));

    const response = await server.app.request("http://localhost/health", {
      headers: { Host: "evil.example.com" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects disallowed hosts globally when allowedOrigins is configured", async () => {
    const server = new MCPServer({
      name: "dns-locked-down",
      version: "1.0.0",
      allowedOrigins: ["http://localhost:3000"],
    });
    server.app.get("/health", (c) => c.text("ok"));

    const healthResponse = await server.app.request("http://localhost/health", {
      headers: { Host: "evil.example.com" },
    });
    const mcpResponse = await server.app.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Host: "evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(healthResponse.status).toBe(403);
    expect(mcpResponse.status).toBe(403);
  });

  it("accepts allowed host values derived from allowedOrigins", async () => {
    const server = new MCPServer({
      name: "dns-allowed-host",
      version: "1.0.0",
      allowedOrigins: ["http://localhost:3000"],
    });
    server.app.get("/health", (c) => c.text("ok"));

    const response = await server.app.request("http://localhost/health", {
      headers: { Host: "localhost:3000" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
