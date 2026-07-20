import { describe, expect, it } from "vitest";

import { HttpConnector } from "../../../src/connectors/http.js";

describe("HttpConnector connection URL validation", () => {
  it("rejects non-http(s) schemes (SSRF hardening)", () => {
    expect(() => new HttpConnector("file:///etc/passwd")).toThrow();
    expect(() => new HttpConnector("gopher://internal:70/_")).toThrow();
  });

  it("rejects malformed URLs", () => {
    expect(() => new HttpConnector("not a url")).toThrow();
  });

  it("accepts http and https URLs", () => {
    expect(
      () => new HttpConnector("https://api.example.com/mcp")
    ).not.toThrow();
    expect(() => new HttpConnector("http://example.com/mcp")).not.toThrow();
  });

  it("still accepts localhost and private hosts (legitimate local MCP servers)", () => {
    expect(() => new HttpConnector("http://localhost:3000/mcp")).not.toThrow();
    expect(() => new HttpConnector("http://127.0.0.1:8080")).not.toThrow();
    expect(() => new HttpConnector("http://192.168.1.10:3000")).not.toThrow();
  });
});
