import { describe, expect, it } from "vitest";

import { assertValidConnectionUrl } from "../../../src/utils/url-sanitize.js";

describe("assertValidConnectionUrl", () => {
  it("accepts http and https", () => {
    expect(() =>
      assertValidConnectionUrl("http://example.com/mcp")
    ).not.toThrow();
    expect(() =>
      assertValidConnectionUrl("https://example.com/mcp")
    ).not.toThrow();
  });

  it("allows loopback and private hosts", () => {
    expect(() =>
      assertValidConnectionUrl("http://localhost:3000")
    ).not.toThrow();
    expect(() =>
      assertValidConnectionUrl("http://127.0.0.1:8080/mcp")
    ).not.toThrow();
    expect(() => assertValidConnectionUrl("http://10.0.0.5")).not.toThrow();
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertValidConnectionUrl("file:///etc/passwd")).toThrow(
      /protocol/i
    );
    expect(() => assertValidConnectionUrl("ftp://host/x")).toThrow(/protocol/i);
    expect(() => assertValidConnectionUrl("gopher://host:70/_")).toThrow(
      /protocol/i
    );
    expect(() => assertValidConnectionUrl("data:text/plain,hi")).toThrow(
      /protocol/i
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => assertValidConnectionUrl("not a url")).toThrow(
      /Invalid MCP connection URL/
    );
    expect(() => assertValidConnectionUrl("")).toThrow(
      /Invalid MCP connection URL/
    );
  });
});
