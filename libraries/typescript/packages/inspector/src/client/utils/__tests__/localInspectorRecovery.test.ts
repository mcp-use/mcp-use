import { describe, expect, it } from "vitest";
import {
  buildLocalInspectorCommand,
  shouldSuggestLocalInspector,
} from "../localInspectorRecovery";

describe("local Inspector recovery", () => {
  it.each([
    "Dynamic Client Registration rejected: invalid_redirect_uri",
    "Redirect URI is not allowed: https://inspector.example.com/oauth/callback",
    "OAuth failed with redirect_uri_mismatch",
    "The redirect URL was rejected because it is not registered",
  ])("suggests localhost for a hosted callback rejection: %s", (error) => {
    expect(shouldSuggestLocalInspector(error, "inspector.example.com")).toBe(
      true
    );
  });

  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])(
    "does not suggest localhost when already running on %s",
    (hostname) => {
      expect(
        shouldSuggestLocalInspector("invalid_redirect_uri", hostname)
      ).toBe(false);
    }
  );

  it("does not suggest localhost for unrelated failures", () => {
    expect(
      shouldSuggestLocalInspector(
        "Connection timed out while initializing",
        "inspector.example.com"
      )
    ).toBe(false);
  });

  it("quotes the server URL safely for a shell", () => {
    expect(
      buildLocalInspectorCommand("https://example.com/mcp?name=it's-safe")
    ).toBe(
      `npx @mcp-use/inspector --url 'https://example.com/mcp?name=it'"'"'s-safe'`
    );
  });
});
