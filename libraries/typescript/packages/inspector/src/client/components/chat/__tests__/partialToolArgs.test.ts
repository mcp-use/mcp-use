import { describe, expect, it } from "vitest";
import { parsePartialToolArgs } from "../partialToolArgs";

describe("parsePartialToolArgs", () => {
  it("returns complete argument objects unchanged", () => {
    expect(parsePartialToolArgs('{"query":"weather"}')).toEqual({
      query: "weather",
    });
  });

  it("heals a truncated string value", () => {
    expect(parsePartialToolArgs('{"query":"wea')).toEqual({ query: "wea" });
  });

  it("ignores braces and brackets inside streamed code or SVG strings", () => {
    expect(
      parsePartialToolArgs(
        '{"view":"<svg><style>.node { fill: blue; }</style><text>[draft]'
      )
    ).toEqual({
      view: "<svg><style>.node { fill: blue; }</style><text>[draft]",
    });
  });

  it("preserves escaped quotes in a partial string", () => {
    expect(parsePartialToolArgs('{"view":"<text id=\\"label\\">hel')).toEqual({
      view: '<text id="label">hel',
    });
  });

  it("omits a dangling escape only from the healed snapshot", () => {
    expect(parsePartialToolArgs('{"code":"line\\nnext\\')).toEqual({
      code: "line\nnext",
    });
  });

  it("waits when an object key is not parseable yet", () => {
    expect(parsePartialToolArgs('{"que')).toBeUndefined();
  });
});
