import { canonicalJson as core } from "@mcp-use/events-core";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/events/canonical-json.js";

describe("registry canonicalJson", () => {
  it("sorts keys at every depth and applies JSON.stringify rules", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: -0 }, NaN] })).toBe(
      '{"a":[{"c":0},null],"b":1}'
    );
  });

  it("matches @mcp-use/events-core on the same inputs", () => {
    const inputs = [
      { z: { y: [3, { b: "é", a: null }] }, a: true },
      ["x", 1.5, { é: 1, e: 2 }],
      "plain",
    ];
    for (const v of inputs) expect(canonicalJson(v)).toBe(core(v));
  });
});
