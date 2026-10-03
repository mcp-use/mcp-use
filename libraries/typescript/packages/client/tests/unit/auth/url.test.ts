import { describe, it, expect } from "vitest";
import { sanitizeUrl } from "../../../src/auth/url.js";

describe("sanitizeUrl", () => {
  describe("IPv6 and hostname support", () => {
    it("allows IPv6 loopback [::1] with port and path", () => {
      const input = "http://[::1]:33418/callback";
      expect(sanitizeUrl(input)).toBe("http://[::1]:33418/callback");
    });

    it("allows bracketed IPv6 addresses", () => {
      expect(sanitizeUrl("https://[2001:db8::1]/auth")).toBe(
        "https://[2001:db8::1]/auth"
      );
      expect(sanitizeUrl("http://[fe80::1]:8080/")).toBe(
        "http://[fe80::1]:8080/"
      );
    });

    it("allows standard localhost and domain hostnames", () => {
      expect(sanitizeUrl("http://localhost:3000/callback")).toBe(
        "http://localhost:3000/callback"
      );
      expect(sanitizeUrl("https://api.example.com/oauth/authorize")).toBe(
        "https://api.example.com/oauth/authorize"
      );
      expect(sanitizeUrl("http://127.0.0.1:8080/")).toBe(
        "http://127.0.0.1:8080/"
      );
    });

    it("rejects hostnames containing invalid or suspicious characters", () => {
      expect(() => sanitizeUrl("https://exam ple.com")).toThrow(
        /Invalid url to pass to open/
      );
      expect(() => sanitizeUrl("https://[invalid-ipv6]")).toThrow(
        /Invalid url to pass to open/
      );
    });
  });

  describe("path and hash encoding", () => {
    it("preserves already percent-encoded path octets without double-encoding", () => {
      expect(sanitizeUrl("https://example.com/api/tenant%201/callback")).toBe(
        "https://example.com/api/tenant%201/callback"
      );
      expect(sanitizeUrl("https://example.com/docs/C%2B%2B")).toBe(
        "https://example.com/docs/C%2B%2B"
      );
      expect(sanitizeUrl("https://example.com/user%2Fprofile")).toBe(
        "https://example.com/user%2Fprofile"
      );
      expect(sanitizeUrl("https://example.com/caf%C3%A9")).toBe(
        "https://example.com/caf%C3%A9"
      );
    });

    it("preserves intentional double-encoded percent octets", () => {
      expect(sanitizeUrl("https://example.com/api/tenant%25201/callback")).toBe(
        "https://example.com/api/tenant%25201/callback"
      );
    });

    it("encodes raw unencoded special characters in paths", () => {
      expect(sanitizeUrl("https://example.com/docs/C++")).toBe(
        "https://example.com/docs/C%2B%2B"
      );
      expect(sanitizeUrl("https://example.com/foo|bar")).toBe(
        "https://example.com/foo%7Cbar"
      );
      expect(sanitizeUrl("https://example.com/foo;bar")).toBe(
        "https://example.com/foo%3Bbar"
      );
      expect(sanitizeUrl("https://example.com/user@data")).toBe(
        "https://example.com/user%40data"
      );
    });

    it("handles paths with spaces normalized during URL parsing", () => {
      expect(sanitizeUrl("https://example.com/foo bar/baz")).toBe(
        "https://example.com/foo%20bar/baz"
      );
    });

    it("encodes rogue percent signs that are not valid hex octets", () => {
      expect(sanitizeUrl("https://example.com/path%zz")).toBe(
        "https://example.com/path%25zz"
      );
    });

    it("preserves SPA route slashes and encoded characters in fragments", () => {
      expect(sanitizeUrl("https://example.com/app#/routes/settings")).toBe(
        "https://example.com/app#/routes/settings"
      );
      expect(sanitizeUrl("https://example.com/auth#token%3Dsecret")).toBe(
        "https://example.com/auth#token%3Dsecret"
      );
      expect(
        sanitizeUrl("https://example.com/auth#token=secret&state=123")
      ).toBe("https://example.com/auth#token=secret&state=123");
    });
  });

  describe("query parameters and credentials", () => {
    it("properly encodes query parameters", () => {
      expect(
        sanitizeUrl(
          "https://example.com/oauth?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&client_id=123"
        )
      ).toBe(
        "https://example.com/oauth?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&client_id=123"
      );
    });

    it("encodes credentials safely", () => {
      expect(sanitizeUrl("https://user%20name:pass@example.com/")).toBe(
        "https://user%20name:pass@example.com/"
      );
    });
  });

  describe("security rejections", () => {
    it("rejects non-http/https protocols", () => {
      // eslint-disable-next-line no-script-url
      expect(() => sanitizeUrl("javascript:alert(1)")).toThrow(
        /Invalid url to pass to open/
      );
      expect(() => sanitizeUrl("file:///etc/passwd")).toThrow(
        /Invalid url to pass to open/
      );
      expect(() => sanitizeUrl("data:text/html,<h1>hi</h1>")).toThrow(
        /Invalid url to pass to open/
      );
      expect(() => sanitizeUrl("ftp://example.com/resource")).toThrow(
        /Invalid url to pass to open/
      );
    });

    it("rejects completely malformed URLs", () => {
      expect(() => sanitizeUrl("not-a-url")).toThrow(
        /Invalid url to pass to open/
      );
      expect(() => sanitizeUrl("")).toThrow(/Invalid url to pass to open/);
    });
  });
});
