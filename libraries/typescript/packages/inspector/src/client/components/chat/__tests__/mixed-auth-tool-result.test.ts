import { describe, expect, it } from "vitest";
import { isAuthenticationRequiredToolResult } from "../mixed-auth-tool-result";

describe("isAuthenticationRequiredToolResult", () => {
  it("recognizes the Notte mixed-auth tool result", () => {
    expect(
      isAuthenticationRequiredToolResult(
        {
          content: [
            {
              type: "text",
              text: "This tool requires authentication. Either reconnect and complete the OAuth sign-in your client offers, or send an Authorization header.",
            },
          ],
          isError: true,
        },
        true
      )
    ).toBe(true);
  });

  it.each([
    "Authentication required to continue",
    "Authorization is required for this operation",
    "Sign in to use this tool",
  ])("recognizes an authentication-required message: %s", (message) => {
    expect(isAuthenticationRequiredToolResult(message, true)).toBe(true);
  });

  it("does not reinterpret successful results", () => {
    expect(
      isAuthenticationRequiredToolResult(
        { content: [{ type: "text", text: "Authentication required" }] },
        false
      )
    ).toBe(false);
  });

  it("does not reinterpret ordinary tool errors", () => {
    expect(
      isAuthenticationRequiredToolResult(
        {
          content: [{ type: "text", text: "The input URL is not supported." }],
          isError: true,
        },
        true
      )
    ).toBe(false);
  });
});
