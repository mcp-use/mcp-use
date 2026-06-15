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

  it("returns false for remote hosts", () => {
    expect(isLocalhostServerUrl("https://mcp.example.com/mcp")).toBe(false);
    expect(isLocalhostServerUrl("https://foo.mcp-use.run/mcp")).toBe(false);
  });

  it("returns false for unparseable URLs", () => {
    expect(isLocalhostServerUrl("not a url")).toBe(false);
    expect(isLocalhostServerUrl("")).toBe(false);
  });
});
