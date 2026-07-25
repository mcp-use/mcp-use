import { describe, expect, it } from "vitest";

import { normalizeCaptureBounds } from "../../src/commands/screenshot.js";

describe("screenshot capture bounds", () => {
  it("pixel-aligns the rendered widget instead of retaining viewport space", () => {
    expect(
      normalizeCaptureBounds({
        x: 0.25,
        y: 1.5,
        width: 767.5,
        height: 508.25,
      })
    ).toEqual({
      x: 0,
      y: 1,
      width: 768,
      height: 509,
    });
  });

  it.each([
    null,
    {},
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: Number.NaN },
  ])("rejects invalid rendered bounds: %j", (bounds) => {
    expect(() => normalizeCaptureBounds(bounds)).toThrow(
      /widget bounds|invalid widget bounds/
    );
  });
});
