import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { resolveViewResourceUri } from "../src/views/constants.js";
import { sha256Hex } from "../src/views/sha256.js";

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

describe("resolveViewResourceUri", () => {
  const views = ["foo", "foo-bar"];

  it.each([
    ["ui://views/foo.html", "foo"],
    ["ui://views/foo-bar.html", "foo-bar"],
    ["ui://views/foo-0123456789abcdef.html", "foo"],
    ["ui://views/foo-bar-0123456789abcdef.html", "foo-bar"],
    ["ui://views/foo-old.html", undefined],
    ["ui://views/foo-0123456789ABCDEF.html", undefined],
    ["ui://views/foo-0123456789abcde.html", undefined],
    ["ui://views/baz-0123456789abcdef.html", undefined],
    ["ui://views/foo", undefined],
    ["ui://other/foo.html", undefined],
  ])("resolves %s to %s", (uri, expected) => {
    expect(resolveViewResourceUri(uri, views)).toBe(expected);
  });
});
