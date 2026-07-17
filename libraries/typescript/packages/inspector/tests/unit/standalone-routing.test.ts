import { describe, expect, it } from "vitest";
import { getDevCallbackRedirect } from "../../src/server/dev-callback-redirect.js";
import { isOpenEndedSseResponse } from "../../src/server/proxy/mcp-proxy.js";

describe("standalone inspector routing", () => {
  it("redirects only legacy root callback aliases", () => {
    expect(getDevCallbackRedirect("/oauth/callback?code=abc&state=123")).toBe(
      "/inspector/oauth/callback?code=abc&state=123"
    );
    expect(getDevCallbackRedirect("/auth/callback?code=abc")).toBe(
      "/inspector/auth/callback?code=abc"
    );
  });

  it("does not redirect canonical callback routes into a loop", () => {
    expect(
      getDevCallbackRedirect("/inspector/oauth/callback?code=abc&state=123")
    ).toBeNull();
    expect(
      getDevCallbackRedirect("/inspector/auth/callback?code=abc")
    ).toBeNull();
  });

  it("streams open-ended SSE responses regardless of request method", () => {
    expect(isOpenEndedSseResponse("text/event-stream", null)).toBe(true);
    expect(
      isOpenEndedSseResponse("text/event-stream; charset=utf-8", null)
    ).toBe(true);
    expect(isOpenEndedSseResponse("text/event-stream", "128")).toBe(false);
    expect(isOpenEndedSseResponse("application/json", null)).toBe(false);
  });
});
