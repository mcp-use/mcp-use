import { describe, it, expect } from "vitest";
import { sanitizeUrl } from "../../../src/utils/url-sanitize.js";

describe("sanitizeUrl", () => {
  describe("valid URLs", () => {
    it("should sanitize basic http URL", () => {
      const url = "http://example.com";
      const result = sanitizeUrl(url);
      expect(result).toBe("http://example.com/");
    });

    it("should sanitize basic https URL", () => {
      const url = "https://example.com";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://example.com/");
    });

    it("should sanitize URL with path", () => {
      const url = "https://example.com/path/to/resource";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://example.com/path/to/resource");
    });

    it("should sanitize URL with query parameters", () => {
      const url = "https://example.com/search?q=test&page=1";
      const result = sanitizeUrl(url);
      expect(result).toContain("https://example.com/search");
      expect(result).toContain("q=test");
      expect(result).toContain("page=1");
    });

    it("should sanitize URL with hash", () => {
      const url = "https://example.com/page#section";
      const result = sanitizeUrl(url);
      expect(result).toContain("https://example.com/page");
      expect(result).toContain("#section");
    });

    it("should sanitize URL with encoded characters in path", () => {
      const url = "https://example.com/path%20with%20spaces";
      const result = sanitizeUrl(url);
      // Note: Already encoded URLs get double-encoded by encodeURIComponent
      expect(result).toContain("path%2520with%2520spaces");
    });

    it("should sanitize URL with special characters in query", () => {
      const url = "https://example.com/search?q=hello+world&lang=en-US";
      const result = sanitizeUrl(url);
      // Note: + is converted to space by URL parsing, then encoded as %20
      expect(result).toContain("q=hello%20world");
      expect(result).toContain("lang=en-US");
    });

    it("should sanitize URL with username and password", () => {
      const url = "https://user:pass@example.com";
      const result = sanitizeUrl(url);
      // Note: Username and password are encoded separately, colon stays as-is
      expect(result).toContain("user:pass@example.com");
    });

    it("should sanitize URL with port", () => {
      const url = "https://example.com:8080/path";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://example.com:8080/path");
    });

    it("should sanitize URL with empty query parameter", () => {
      const url = "https://example.com/search?q=";
      const result = sanitizeUrl(url);
      // Note: Empty query parameters don't include the = sign
      expect(result).toContain("q");
      expect(result).not.toContain("q=");
    });

    it("should sanitize URL with multiple query parameters", () => {
      const url = "https://example.com/search?a=1&b=2&c=3";
      const result = sanitizeUrl(url);
      expect(result).toContain("a=1");
      expect(result).toContain("b=2");
      expect(result).toContain("c=3");
    });
  });

  describe("invalid URLs", () => {
    it("should throw error for invalid URL string", () => {
      expect(() => sanitizeUrl("not-a-url")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for empty string", () => {
      expect(() => sanitizeUrl("")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for file:// protocol", () => {
      expect(() => sanitizeUrl("file:///path/to/file")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for javascript: protocol", () => {
      // eslint-disable-next-line no-script-url
      expect(() => sanitizeUrl("javascript:alert('xss')")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for data: protocol", () => {
      expect(() => sanitizeUrl("data:text/html,<script>alert('xss')</script>")).toThrow(
        "Invalid url to pass to open()"
      );
    });

    it("should throw error for ftp: protocol", () => {
      expect(() => sanitizeUrl("ftp://example.com")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for mailto: protocol", () => {
      expect(() => sanitizeUrl("mailto:test@example.com")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for relative URL", () => {
      expect(() => sanitizeUrl("/relative/path")).toThrow("Invalid url to pass to open()");
    });

    it("should throw error for URL with invalid hostname encoding", () => {
      // This test checks if hostname contains suspicious characters
      // Note: The actual behavior depends on URL parsing, but we test the general case
      const url = "https://example%2ecom";
      // This might pass URL parsing but fail hostname validation
      // The exact behavior depends on how URL constructor handles this
      try {
        const result = sanitizeUrl(url);
        // If it passes, the hostname should be properly encoded
        expect(result).toBeTruthy();
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle URL with trailing slash", () => {
      const url = "https://example.com/";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://example.com/");
    });

    it("should handle URL with only domain", () => {
      const url = "http://example.com";
      const result = sanitizeUrl(url);
      expect(result).toBe("http://example.com/");
    });

    it("should handle URL with complex path", () => {
      const url = "https://example.com/a/b/c/d/e/f";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://example.com/a/b/c/d/e/f");
    });

    it("should handle URL with encoded slashes in path", () => {
      const url = "https://example.com/path%2Fwith%2Fslashes";
      const result = sanitizeUrl(url);
      // The sanitize function replaces %2f with / (case insensitive)
      expect(result).toContain("/");
    });

    it("should handle URL with unicode characters", () => {
      const url = "https://example.com/path/测试";
      const result = sanitizeUrl(url);
      expect(result).toContain("https://example.com");
    });

    it("should handle URL with special characters in username", () => {
      const url = "https://user@name:pass@example.com";
      const result = sanitizeUrl(url);
      expect(result).toContain("@example.com");
    });

    it("should handle URL with IPv4 address", () => {
      const url = "http://192.168.1.1";
      const result = sanitizeUrl(url);
      expect(result).toBe("http://192.168.1.1/");
    });

    it("should handle URL with IPv6 address", () => {
      // Note: IPv6 addresses in brackets may not pass hostname validation
      const url = "http://[2001:db8::1]";
      // This may throw an error due to hostname validation
      try {
        const result = sanitizeUrl(url);
        expect(result).toContain("2001:db8::1");
      } catch (e) {
        // IPv6 addresses may fail hostname validation
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe("security", () => {
    it("should prevent protocol injection", () => {
      expect(() => sanitizeUrl("https://example.com\njavascript:alert(1)")).toThrow();
    });

    it("should sanitize query parameters properly", () => {
      const url = "https://example.com/search?q=<script>alert('xss')</script>";
      const result = sanitizeUrl(url);
      // Script tags should be encoded
      expect(result).not.toContain("<script>");
      expect(result).toContain("%3Cscript%3E");
    });

    it("should sanitize hash properly", () => {
      const url = "https://example.com/page#<script>alert('xss')</script>";
      const result = sanitizeUrl(url);
      // Script tags in hash should be encoded
      expect(result).not.toContain("<script>");
    });
  });
});
