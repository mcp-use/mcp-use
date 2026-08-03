import { describe, expect, it } from "vitest";
import { buildLightDarkValue } from "../useMcpAppsHostContext";

describe("buildLightDarkValue", () => {
  it("builds a CSS light-dark pair", () => {
    expect(
      buildLightDarkValue("oklch(1 0 0)", "oklch(0.141 0.005 285.823)")
    ).toBe("light-dark(oklch(1 0 0), oklch(0.141 0.005 285.823))");
  });

  it("falls back when one side is unavailable", () => {
    expect(buildLightDarkValue("white", "")).toBe("white");
    expect(buildLightDarkValue("", "black")).toBe("black");
  });
});
