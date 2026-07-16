import { describe, expect, it } from "vitest";
import { deriveOAuthProxyUrl } from "../../../src/react/useMcp-helpers.js";

describe("deriveOAuthProxyUrl", () => {
  it("derives the OAuth endpoint from an Inspector MCP proxy", () => {
    expect(
      deriveOAuthProxyUrl(
        "https://inspector.example.com/inspector/api/proxy",
        undefined
      )
    ).toBe("https://inspector.example.com/inspector/api/oauth");
  });

  it("keeps an explicit OAuth proxy unchanged", () => {
    expect(
      deriveOAuthProxyUrl(
        "https://inspector.example.com/inspector/api/proxy",
        "https://oauth.example.com/proxy"
      )
    ).toBe("https://oauth.example.com/proxy");
  });
});
