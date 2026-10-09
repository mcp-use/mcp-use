import { describe, expect, it, vi } from "vitest";
import { getOAuthTokenExpiry } from "../../../src/react/token-expiry.js";

function jwt(claims: number | Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = typeof claims === "number" ? { exp: claims } : claims;
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

describe("getOAuthTokenExpiry", () => {
  it("prefers JWT exp over expires_in", () => {
    const exp = 1_800_000_000;
    expect(
      getOAuthTokenExpiry({ access_token: jwt(exp), expires_in: 60 })
    ).toBe(exp * 1000);
  });

  it.each([
    ["-", { exp: 1_800_000_000, pad: "¾" }],
    [
      "_",
      {
        exp: 1_800_000_000,
        sub: "auth0|65f8a9d0_123-abc",
        scope: "read:mcp write:mcp",
        pad: "ǿ",
      },
    ],
  ])("reads exp from Base64URL payloads containing %s", (char, claims) => {
    const token = jwt(claims);
    // Whether the encoding contains the character depends on byte alignment,
    // so guard the fixture instead of letting it silently stop covering it.
    expect(token.split(".")[1]).toContain(char);
    expect(getOAuthTokenExpiry({ access_token: token })).toBe(
      claims.exp * 1000
    );
  });

  it("uses expires_in for opaque tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(
      getOAuthTokenExpiry({ access_token: "opaque", expires_in: 60 })
    ).toBe(Date.now() + 60_000);
    vi.useRealTimers();
  });

  it("calculates expires_in from the token receipt time", () => {
    const receivedAt = Date.parse("2026-01-01T21:12:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T21:42:00Z"));
    try {
      const expiry = getOAuthTokenExpiry({
        access_token: "opaque",
        expires_in: 3600,
        _mcp_use_received_at: receivedAt,
      });

      expect(expiry).toBe(Date.parse("2026-01-01T22:12:00Z"));
      expect(expiry).not.toBe(Date.now() + 3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
