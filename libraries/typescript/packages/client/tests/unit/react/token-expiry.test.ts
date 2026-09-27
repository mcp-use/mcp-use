import { describe, expect, it, vi } from "vitest";
import { getOAuthTokenExpiry } from "../../../src/react/token-expiry.js";

function jwt(exp: number): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.sig`;
}

describe("getOAuthTokenExpiry", () => {
  it("prefers JWT exp over expires_in", () => {
    const exp = 1_800_000_000;
    expect(
      getOAuthTokenExpiry({ access_token: jwt(exp), expires_in: 60 })
    ).toBe(exp * 1000);
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
