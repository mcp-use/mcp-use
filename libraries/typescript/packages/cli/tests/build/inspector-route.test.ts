import { describe, expect, it } from "vitest";

import { isInspectorPath } from "../../src/toolchain/inspector-route.js";

describe("isInspectorPath", () => {
  it("matches the mount when basePath is the root", () => {
    // assertServerConfig accepts basePath "/", and naive interpolation would
    // require "//inspector", which no client requests.
    expect(isInspectorPath("/inspector", "/")).toBe(true);
    expect(isInspectorPath("/inspector/api/dev/info", "/")).toBe(true);
    expect(isInspectorPath("/", "/")).toBe(false);
  });
});
