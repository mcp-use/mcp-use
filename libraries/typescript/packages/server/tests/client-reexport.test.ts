import { describe, expect, it } from "vitest";
import { MCPClient, importMcpClient } from "../src/client.js";

describe("MCPClient back-compat re-export", () => {
  it("loads MCPClient from the optional @mcp-use/client peer", async () => {
    const mod = await importMcpClient();
    expect(mod.MCPClient).toBe(MCPClient);
  });

  it("constructs a client instance", () => {
    const client = new MCPClient({
      mcpServers: {
        demo: { url: "http://127.0.0.1:9/mcp" },
      },
    });
    expect(typeof client.connect).toBe("function");
  });
});
