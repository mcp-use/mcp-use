import { describe, expect, it } from "vitest";

import { loadClientPackage } from "../../src/commands/load-client.js";

describe("loadClientPackage", () => {
  it("loads @mcp-use/client when installed", async () => {
    const mod = await loadClientPackage();
    expect(mod.MCPClient).toBeTypeOf("function");
    expect(mod.createOAuthProvider).toBeTypeOf("function");
  });
});
