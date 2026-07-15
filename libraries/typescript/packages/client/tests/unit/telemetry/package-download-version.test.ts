import { describe, expect, it } from "vitest";
import { isVersionGreater } from "../../../src/telemetry/telemetry.js";

describe("isVersionGreater", () => {
  it("compares numeric semver segments (not lexicographic strings)", () => {
    expect(isVersionGreater("1.0.10", "1.0.9")).toBe(true);
    expect(isVersionGreater("1.0.9", "1.0.10")).toBe(false);
    expect(isVersionGreater("2.0.0", "1.99.99")).toBe(true);
  });

  it("returns false for equal versions", () => {
    expect(isVersionGreater("1.2.3", "1.2.3")).toBe(false);
    expect(isVersionGreater("1.2.3-rc", "1.2.3")).toBe(false);
  });

  it("handles unequal segment counts", () => {
    expect(isVersionGreater("1.0.0.1", "1.0.0")).toBe(true);
    expect(isVersionGreater("1.0", "1.0.0.1")).toBe(false);
  });
});
