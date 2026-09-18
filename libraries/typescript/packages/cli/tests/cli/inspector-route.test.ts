import { describe, expect, it } from "vitest";

import { isInspectorPath } from "../../src/cli/inspector-route.js";

describe("isInspectorPath", () => {
  it("matches the mount under a nested basePath", () => {
    expect(isInspectorPath("/mcp/inspector", "/mcp")).toBe(true);
    expect(isInspectorPath("/mcp/inspector/api/dev/info", "/mcp")).toBe(true);
    expect(isInspectorPath("/mcp", "/mcp")).toBe(false);
    expect(isInspectorPath("/inspector", "/mcp")).toBe(false);
  });

  it("matches the mount when basePath is the root", () => {
    // assertServerConfig accepts basePath "/", and naive interpolation would
    // require "//inspector", which no client requests.
    expect(isInspectorPath("/inspector", "/")).toBe(true);
    expect(isInspectorPath("/inspector/api/dev/info", "/")).toBe(true);
    expect(isInspectorPath("/", "/")).toBe(false);
  });
});
