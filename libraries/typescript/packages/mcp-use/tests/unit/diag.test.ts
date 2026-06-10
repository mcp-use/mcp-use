// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
describe("diag", () => {
  it("inspects localStorage", () => {
    const info = {
      typeofLocalStorage: typeof localStorage,
      typeofWindowLS: typeof (globalThis as any).window?.localStorage,
      hasClear: typeof (localStorage as any)?.clear,
      node: process.version,
    };
    expect(JSON.stringify(info)).toBe("FORCE_FAIL");
  });
});
