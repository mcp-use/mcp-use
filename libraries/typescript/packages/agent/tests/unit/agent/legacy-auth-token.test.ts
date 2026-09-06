import { describe, expect, it } from "vitest";

import { withResolvedAuthTokens } from "../../../src/agents/types.js";

/**
 * `MCPServerConfig` advertises `auth_token` for configurations shared with the
 * Python SDK, but `@mcp-use/client` only reads `authToken`, so the legacy
 * spelling produced no `Authorization` header at all.
 */
describe("withResolvedAuthTokens", () => {
  it("resolves the legacy token onto the field the client reads", () => {
    expect(
      withResolvedAuthTokens({
        legacy: { url: "https://api.example.com/mcp", auth_token: "secret" },
      })
    ).toEqual({
      legacy: {
        url: "https://api.example.com/mcp",
        auth_token: "secret",
        authToken: "secret",
      },
    });
  });

  it("leaves an explicit authToken and unrelated servers alone", () => {
    const servers = {
      explicit: {
        url: "https://api.example.com/mcp",
        auth_token: "legacy",
        authToken: "current",
      },
      stdio: { command: "npx", args: ["server"] },
    };

    expect(withResolvedAuthTokens(servers)).toEqual(servers);
  });
});
