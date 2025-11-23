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

  it("executes code through client method", async () => {
    const client = new MCPClient({}, { codeMode: true });

    const result = await client.executeCode("return 42;");
    expect(result.result).toBe(42);
  });

  it("searches tools through client method", async () => {
    const client = new MCPClient({}, { codeMode: true });

    const tools = await client.searchTools("", "names");
    // Should include at least the code mode tools if no other servers are added
    // But wait, code_mode server is excluded from normal discovery to avoid recursion?
    // The search_tools implementation in CodeExecutor filters OUT 'code_mode'
    // So if no other servers, it should be empty
    expect(tools).toEqual([]);
  });
});
