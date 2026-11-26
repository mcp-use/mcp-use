import { describe, expect, it } from "vitest";

import { resolveViewResourceUri } from "../src/views/constants.js";

describe("resolveViewResourceUri", () => {
  const views = ["foo", "foo-bar"];

  it.each([
    ["ui://views/foo.html", "foo"],
    ["ui://views/foo.html?v=0123abcd", "foo"],
    ["ui://views/foo.html?v=anything", "foo"],
    ["ui://views/foo-bar.html?v=0123abcd", "foo-bar"],
    ["ui://views/foo-bar.html", "foo-bar"],
    ["ui://views/foo-0123456789abcdef.html", "foo"],
    ["ui://views/foo-bar-0123456789abcdef.html", "foo-bar"],
    ["ui://views/foo-old.html", undefined],
    ["ui://views/foo-0123456789ABCDEF.html", undefined],
    ["ui://views/foo-0123456789abcde.html", undefined],
    ["ui://views/baz-0123456789abcdef.html", undefined],
    ["ui://views/foo", undefined],
    ["ui://views/foo?v=0123abcd", undefined],
    ["ui://other/foo.html", undefined],
  ])("resolves %s to %s", (uri, expected) => {
    expect(resolveViewResourceUri(uri, views)).toBe(expected);
  });
});
