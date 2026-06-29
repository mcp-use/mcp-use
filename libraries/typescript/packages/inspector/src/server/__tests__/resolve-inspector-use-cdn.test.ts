import { describe, expect, it } from "vitest";
import { resolveInspectorUseCdn } from "../shared-static.js";

describe("resolveInspectorUseCdn", () => {
  it("defaults to CDN in production", () => {
    expect(resolveInspectorUseCdn({ NODE_ENV: "production" })).toBe(true);
  });

  it("serves local dist/web in development by default", () => {
    expect(resolveInspectorUseCdn({ NODE_ENV: "development" })).toBe(false);
  });

  it("allows INSPECTOR_USE_CDN=false to force offline in production", () => {
    expect(
      resolveInspectorUseCdn({
        NODE_ENV: "production",
        INSPECTOR_USE_CDN: "false",
      })
    ).toBe(false);
  });

  it("allows INSPECTOR_USE_CDN=true to force CDN in non-production", () => {
    expect(
      resolveInspectorUseCdn({
        NODE_ENV: "test",
        INSPECTOR_USE_CDN: "true",
      })
    ).toBe(true);
  });
});
