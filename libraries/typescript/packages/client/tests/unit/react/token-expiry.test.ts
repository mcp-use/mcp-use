import { describe, expect, it, vi } from "vitest";
import { getOAuthTokenExpiry } from "../../../src/react/token-expiry.js";

function jwt(payload: Record<string, unknown> | number): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = typeof payload === "number" ? { exp: payload } : payload;
  return `${encode({ alg: "none" })}.${encode(claims)}.sig`;
}

describe("getOAuthTokenExpiry", () => {
  it("prefers JWT exp over expires_in", () => {
    const exp = 1_800_000_000;
    expect(
      getOAuthTokenExpiry({ access_token: jwt(exp), expires_in: 60 })
    ).toBe(exp * 1000);
  });

  it("decodes RFC 7515 Base64URL payloads containing hyphen and underscore characters", () => {
    // Specifically crafted claims whose base64url representations contain '-' (62) and '_' (63)
    const exp = 1_850_000_000;
    const tokenWithHyphen = jwt({ exp, pad: "¾" });
    expect(tokenWithHyphen).toContain("-");
    expect(getOAuthTokenExpiry({ access_token: tokenWithHyphen })).toBe(
      exp * 1000
    );

    const tokenWithUnderscore = jwt({
      exp,
      sub: "auth0|65f8a9d0_123-abc",
      scope: "read:mcp write:mcp",
      pad: "ǿ",
    });
    expect(tokenWithUnderscore).toContain("_");
    expect(getOAuthTokenExpiry({ access_token: tokenWithUnderscore })).toBe(
      exp * 1000
    );
  });

  it("handles unpadded Base64URL tokens whose lengths are not divisible by 4", () => {
    const exp = 1_820_000_000;
    // Vary payload size to produce base64url segment lengths % 4 == 2 and % 4 == 3
    for (const pad of ["a", "ab", "abc", "abcd"]) {
      const token = jwt({ exp, pad });
      const payloadPart = token.split(".")[1]!;
      expect(payloadPart.endsWith("=")).toBe(false);
      expect(getOAuthTokenExpiry({ access_token: token })).toBe(exp * 1000);
    }
  });

  it("correctly decodes multi-byte UTF-8 claims without corrupting characters or failing JSON parse", () => {
    const exp = 1_830_000_000;
    const tokenWithUtf8 = jwt({
      exp,
      name: "René François",
      org: "株式会社テスト",
      status: "active 🚀",
    });
    expect(getOAuthTokenExpiry({ access_token: tokenWithUtf8 })).toBe(
      exp * 1000
    );
  });

  it("resolves JWT exp when expires_in is undefined", () => {
    const exp = 1_840_000_000;
    expect(getOAuthTokenExpiry({ access_token: jwt(exp) })).toBe(exp * 1000);
  });

  it("uses expires_in for opaque tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(
      getOAuthTokenExpiry({ access_token: "opaque", expires_in: 60 })
    ).toBe(Date.now() + 60_000);
    expect(
      getOAuthTokenExpiry({
        access_token: "mcp_at_live_sec_1234567890",
        expires_in: 120,
      })
    ).toBe(Date.now() + 120_000);
    vi.useRealTimers();
  });

  it("falls back to expires_in when JWT lacks an exp claim", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const tokenNoExp = jwt({ sub: "user_123" });
    expect(
      getOAuthTokenExpiry({ access_token: tokenNoExp, expires_in: 300 })
    ).toBe(Date.now() + 300_000);
    vi.useRealTimers();
  });

  it("falls back to expires_in when token is malformed or invalid base64", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(
      getOAuthTokenExpiry({
        access_token: "header.invalid!!!chars.sig",
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    expect(
      getOAuthTokenExpiry({
        access_token: "only-one-part",
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    // Invalid UTF-8 byte sequence
    const invalidUtf8Token = `header.${Buffer.from([0xff]).toString("base64url")}.sig`;
    expect(
      getOAuthTokenExpiry({
        access_token: invalidUtf8Token,
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    vi.useRealTimers();
  });

  it("falls back to expires_in when exp claim is not a positive finite number", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(
      getOAuthTokenExpiry({
        access_token: jwt({ exp: "1800000000" as unknown as number }),
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    expect(
      getOAuthTokenExpiry({
        access_token: jwt({ exp: -100 }),
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    expect(
      getOAuthTokenExpiry({
        access_token: jwt({ exp: 0 }),
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    expect(
      getOAuthTokenExpiry({
        access_token: jwt({ exp: null as unknown as number }),
        expires_in: 60,
      })
    ).toBe(Date.now() + 60_000);
    vi.useRealTimers();
  });

  it("returns undefined when neither exp nor valid expires_in is present", () => {
    expect(getOAuthTokenExpiry({})).toBeUndefined();
    expect(getOAuthTokenExpiry({ access_token: "opaque" })).toBeUndefined();
    expect(
      getOAuthTokenExpiry({
        access_token: jwt({ sub: "user_123" }),
        expires_in: "invalid",
      })
    ).toBeUndefined();
  });
});
