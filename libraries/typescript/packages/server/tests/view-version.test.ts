import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { resolveViewResourceUri } from "../src/views/constants.js";
import { sha256Hex } from "../src/views/sha256.js";
import { computeViewVersion } from "../src/views/version.js";

describe("sha256Hex", () => {
  it.each([
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
    "ünïcödé ✓ 🚀",
  ])("matches node:crypto for a %#-th input", (text) => {
    expect(sha256Hex(text)).toBe(
      createHash("sha256").update(text, "utf8").digest("hex")
    );
  });

  it("matches the FIPS 180-4 test vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("computeViewVersion", () => {
  it("hashes the built bundle into 8 hex characters", () => {
    expect(
      computeViewVersion({ kind: "inline", js: "console.log(1)", css: "" })
    ).toBe(sha256Hex("console.log(1)\0").slice(0, 8));
    expect(
      computeViewVersion({
        kind: "external",
        entry: "assets/view-a1b2.js",
        css: ["assets/view-c3d4.css"],
      })
    ).toBe(sha256Hex("assets/view-a1b2.js\0assets/view-c3d4.css").slice(0, 8));
  });

  it("ignores view config, which is not part of the bundle", () => {
    const entry = { kind: "inline", js: "x", css: "" } as const;
    expect(
      computeViewVersion({ ...entry, viewConfig: { displayModes: ["inline"] } })
    ).toBe(computeViewVersion(entry));
  });
});

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
