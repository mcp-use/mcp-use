import { describe, expect, it } from "vitest";
import {
  detectToolResourceUri,
  extractViewName,
  parseDeviceScaleFactor,
  parseDimension,
  parseHeaderArg,
  parseHeaderArgs,
  requiresArguments,
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

describe("parseDeviceScaleFactor", () => {
  it("parses positive integers", () => {
    expect(parseDeviceScaleFactor("1")).toBe(1);
    expect(parseDeviceScaleFactor("2")).toBe(2);
    expect(parseDeviceScaleFactor("3")).toBe(3);
  });

  it("parses fractional values", () => {
    expect(parseDeviceScaleFactor("1.5")).toBe(1.5);
    expect(parseDeviceScaleFactor("2.75")).toBe(2.75);
  });

  it("accepts the upper bound of 4", () => {
    expect(parseDeviceScaleFactor("4")).toBe(4);
  });

  it("rejects zero, negatives, NaN", () => {
    expect(() => parseDeviceScaleFactor("0")).toThrow(/positive number/);
    expect(() => parseDeviceScaleFactor("-1")).toThrow(/positive number/);
    expect(() => parseDeviceScaleFactor("-0.5")).toThrow(/positive number/);
    expect(() => parseDeviceScaleFactor("abc")).toThrow(/positive number/);
    expect(() => parseDeviceScaleFactor("")).toThrow(/positive number/);
  });

  it("rejects values above 4", () => {
    expect(() => parseDeviceScaleFactor("5")).toThrow(/<= 4/);
    expect(() => parseDeviceScaleFactor("100")).toThrow(/<= 4/);
  });
});

describe("requiresArguments", () => {
  it("returns true when required is a non-empty array", () => {
    expect(requiresArguments({ required: ["foo"] })).toBe(true);
    expect(requiresArguments({ required: ["foo", "bar"] })).toBe(true);
  });

  it("returns false when required is missing, empty, or non-array", () => {
    expect(requiresArguments({})).toBe(false);
    expect(requiresArguments({ required: [] })).toBe(false);
    expect(requiresArguments({ required: "foo" })).toBe(false);
    expect(requiresArguments({ required: null })).toBe(false);
  });

  it("returns false for nullish or non-object input", () => {
    expect(requiresArguments(undefined)).toBe(false);
    expect(requiresArguments(null)).toBe(false);
    expect(requiresArguments("not a schema")).toBe(false);
    expect(requiresArguments(42)).toBe(false);
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

describe("parseHeaderArg", () => {
  it("splits on the first colon", () => {
    expect(parseHeaderArg("Authorization: Bearer xyz")).toEqual([
      "Authorization",
      "Bearer xyz",
    ]);
  });

  it("trims whitespace around key and value", () => {
    expect(parseHeaderArg("  X-Api-Key  :   abc123 ")).toEqual([
      "X-Api-Key",
      "abc123",
    ]);
  });

  it("preserves colons inside the value", () => {
    expect(parseHeaderArg("X-Date: 2024-01-01T12:00:00Z")).toEqual([
      "X-Date",
      "2024-01-01T12:00:00Z",
    ]);
  });

  it("accepts no whitespace after the colon", () => {
    expect(parseHeaderArg("Authorization:Bearer xyz")).toEqual([
      "Authorization",
      "Bearer xyz",
    ]);
  });

  it("allows an empty value", () => {
    expect(parseHeaderArg("X-Empty:")).toEqual(["X-Empty", ""]);
  });

  it("errors when there is no colon", () => {
    expect(() => parseHeaderArg("Authorization Bearer xyz")).toThrow(
      /Expected "Key: Value"/
    );
  });

  it("errors when the key is empty", () => {
    expect(() => parseHeaderArg(": value")).toThrow(/Header name is empty/);
  });
});

describe("parseHeaderArgs", () => {
  it("returns an empty record for no args", () => {
    expect(parseHeaderArgs([])).toEqual({});
  });

  it("collects multiple headers into a record", () => {
    expect(
      parseHeaderArgs(["Authorization: Bearer xyz", "X-Trace-Id: abc"])
    ).toEqual({
      Authorization: "Bearer xyz",
      "X-Trace-Id": "abc",
    });
  });

  it("later values for the same key override earlier ones", () => {
    expect(parseHeaderArgs(["X-Key: first", "X-Key: second"])).toEqual({
      "X-Key": "second",
    });
  });

  it("propagates parse errors", () => {
    expect(() =>
      parseHeaderArgs(["Authorization: Bearer xyz", "no-colon"])
    ).toThrow(/Expected "Key: Value"/);
  });
});
