import { describe, expect, it } from "vitest";
import { isLocalhostServerUrl } from "../serverUrl";

describe("isLocalhostServerUrl", () => {
  it("returns true for loopback hostnames", () => {
    expect(isLocalhostServerUrl("http://localhost:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("http://127.0.0.1:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("http://[::1]:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("http://0.0.0.0:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("https://LOCALHOST/mcp")).toBe(true);
  });

  it("returns true across the full 127.0.0.0/8 loopback range", () => {
    expect(isLocalhostServerUrl("http://127.0.0.2:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("http://127.1.2.3:3000/mcp")).toBe(true);
    expect(isLocalhostServerUrl("http://127.255.255.255/mcp")).toBe(true);
  });

  it("returns false for remote hosts", () => {
    expect(isLocalhostServerUrl("https://mcp.example.com/mcp")).toBe(false);
    expect(isLocalhostServerUrl("https://foo.mcp-use.run/mcp")).toBe(false);
  });

  it("does not treat near-loopback hostnames/addresses as loopback", () => {
    // Hostname that merely starts with "127." is not loopback.
    expect(isLocalhostServerUrl("https://127.example.com/mcp")).toBe(false);
    // 128.x is outside 127.0.0.0/8.
    expect(isLocalhostServerUrl("http://128.0.0.1:3000/mcp")).toBe(false);
    // Octet out of range — not a parseable URL, so not loopback.
    expect(isLocalhostServerUrl("http://127.0.0.256:3000/mcp")).toBe(false);
  });

  it("returns false for unparseable URLs", () => {
    expect(isLocalhostServerUrl("not a url")).toBe(false);
    expect(isLocalhostServerUrl("")).toBe(false);
  });
});
