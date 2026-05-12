import { describe, expect, it } from "vitest";
import {
  detectToolResourceUri,
  extractViewName,
  parseDimension,
  timestampSuffix,
} from "../src/commands/screenshot.js";

describe("timestampSuffix", () => {
  it("returns a YYYY-MM-DD_HH-mm-ss string", () => {
    const ts = timestampSuffix();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });

  it("formats a known date correctly", () => {
    const d = new Date(2024, 0, 15, 10, 30, 5); // 2024-01-15 10:30:05
    expect(timestampSuffix(d)).toBe("2024-01-15_10-30-05");
  });

  it("pads single-digit months, days, hours, minutes, seconds", () => {
    const d = new Date(2024, 0, 1, 0, 0, 0);
    expect(timestampSuffix(d)).toBe("2024-01-01_00-00-00");
  });
});

describe("extractViewName", () => {
  it("strips ui://widget/ prefix and .html suffix", () => {
    expect(extractViewName("ui://widget/kanban-board.html")).toBe(
      "kanban-board"
    );
  });

  it("strips a trailing buildId segment", () => {
    expect(extractViewName("ui://widget/kanban-board.abc123def.html")).toBe(
      "kanban-board"
    );
  });

  it("returns the original string when prefix doesn't match", () => {
    expect(extractViewName("not-a-widget-uri")).toBe("not-a-widget-uri");
  });
});

describe("parseDimension", () => {
  it("parses positive integers", () => {
    expect(parseDimension("800", "width")).toBe(800);
    expect(parseDimension("1", "height")).toBe(1);
  });

  it("rejects zero, negatives, NaN", () => {
    expect(() => parseDimension("0", "width")).toThrow(/positive integer/);
    expect(() => parseDimension("-1", "width")).toThrow(/positive integer/);
    expect(() => parseDimension("abc", "width")).toThrow(/positive integer/);
  });
});

describe("detectToolResourceUri", () => {
  it("returns null for a tool without _meta", () => {
    expect(detectToolResourceUri({})).toBeNull();
    expect(detectToolResourceUri(undefined)).toBeNull();
    expect(detectToolResourceUri(null)).toBeNull();
  });

  it("returns null when _meta is empty or has no UI keys", () => {
    expect(detectToolResourceUri({ _meta: {} })).toBeNull();
    expect(detectToolResourceUri({ _meta: { unrelated: "value" } })).toBeNull();
  });

  it("reads _meta.ui.resourceUri", () => {
    expect(
      detectToolResourceUri({
        _meta: { ui: { resourceUri: "ui://widget/board.html" } },
      })
    ).toBe("ui://widget/board.html");
  });

  it('falls back to _meta["openai/outputTemplate"]', () => {
    expect(
      detectToolResourceUri({
        _meta: { "openai/outputTemplate": "ui://widget/list.html" },
      })
    ).toBe("ui://widget/list.html");
  });

  it("prefers _meta.ui.resourceUri over openai/outputTemplate", () => {
    expect(
      detectToolResourceUri({
        _meta: {
          ui: { resourceUri: "ui://widget/preferred.html" },
          "openai/outputTemplate": "ui://widget/fallback.html",
        },
      })
    ).toBe("ui://widget/preferred.html");
  });
});
