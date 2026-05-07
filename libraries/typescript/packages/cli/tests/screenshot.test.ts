import { describe, expect, it } from "vitest";
import {
  encodePropsParam,
  extractViewName,
  parseDimension,
  parseHeaders,
  timestampSuffix,
} from "../src/commands/screenshot.js";

describe("parseHeaders", () => {
  it("returns empty object when no auth or headers", () => {
    expect(parseHeaders(undefined, undefined)).toEqual({});
    expect(parseHeaders([], undefined)).toEqual({});
  });

  it("includes Bearer token when --auth is provided", () => {
    expect(parseHeaders(undefined, "abc123")).toEqual({
      Authorization: "Bearer abc123",
    });
  });

  it("parses repeated --header values", () => {
    const headers = parseHeaders(["X-Foo: bar", "X-Bar:  baz "], undefined);
    expect(headers).toEqual({ "X-Foo": "bar", "X-Bar": "baz" });
  });

  it("merges --header on top of --auth", () => {
    const headers = parseHeaders(["Authorization: Bearer override"], "ignored");
    expect(headers["Authorization"]).toBe("Bearer override");
  });

  it("throws on missing colon", () => {
    expect(() => parseHeaders(["bogus"], undefined)).toThrow(
      /Invalid --header/
    );
  });

  it("throws on empty key", () => {
    expect(() => parseHeaders([": value"], undefined)).toThrow(/Empty key/);
  });
});

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

describe("encodePropsParam", () => {
  it("round-trips through base64", () => {
    const props = {
      toolInput: { a: 1 },
      toolOutput: { servers: [{ name: "x" }] },
    };
    const encoded = encodePropsParam(props);
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    expect(decoded).toEqual(props);
  });

  it("produces URL-safe base64 (no whitespace)", () => {
    const encoded = encodePropsParam({ toolInput: { x: "y" } });
    expect(encoded).not.toContain(" ");
    expect(encoded).not.toContain("\n");
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
