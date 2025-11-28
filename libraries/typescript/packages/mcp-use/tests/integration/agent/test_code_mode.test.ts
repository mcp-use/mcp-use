import { describe, it, expect } from "vitest";
import { MCPClient } from "../../../src/client.js";

describe("Code Mode Integration", () => {
  it("enables code mode when configured", () => {
    const client = new MCPClient({}, { codeMode: true });
    expect(client.codeMode).toBe(true);

    const sessions = client.getAllActiveSessions();
    expect(sessions["code_mode"]).toBeDefined();
    expect(sessions["code_mode"].connector.publicIdentifier.name).toBe(
      "code_mode"
    );
  });

  it("enables code mode with semantic config", () => {
    const client = new MCPClient(
      {},
      {
        codeMode: {
          enabled: true,
          semantic: {
            mode: "string_match",
          },
        },
      }
    );
    expect(client.codeMode).toBe(true);
  });

  it("executes code through client method", async () => {
    const client = new MCPClient({}, { codeMode: true });

    const result = await client.executeCode("return 42;");
    expect(result.result).toBe(42);
  });

  it("searches tools through client method", async () => {
    const client = new MCPClient({}, { codeMode: true });

    const result = await client.searchTools("", "names");
    // Should include at least the code mode tools if no other servers are added
    // But wait, code_mode server is excluded from normal discovery to avoid recursion?
    // The search_tools implementation in CodeExecutor filters OUT 'code_mode'
    // So if no other servers, it should be empty
    expect(result.results).toEqual([]);
    expect(result.meta.total_tools).toBe(0);
    expect(result.meta.namespaces).toEqual([]);
    expect(result.meta.result_count).toBe(0);
  });

  it("uses string_match search mode by default", async () => {
    const client = new MCPClient({}, { codeMode: true });

    // String match should work without any dependencies
    const result = await client.searchTools("test", "names");
    expect(result.meta).toBeDefined();
    expect(result.results).toBeDefined();
  });

  it("supports fuzzy search mode configuration", () => {
    const client = new MCPClient(
      {},
      {
        codeMode: {
          enabled: true,
          semantic: {
            mode: "fuzzy",
          },
        },
      }
    );
    expect(client.codeMode).toBe(true);
  });

  it("supports embeddings search mode configuration", () => {
    const client = new MCPClient(
      {},
      {
        codeMode: {
          enabled: true,
          semantic: {
            mode: "embeddings",
            embeddingsUrl: "https://api.example.com/v1/embeddings",
          },
        },
      }
    );
    expect(client.codeMode).toBe(true);
  });
});
