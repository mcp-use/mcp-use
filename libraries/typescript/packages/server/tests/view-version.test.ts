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

  it("ignores the frontend viewConfig captured in the manifest entry", () => {
    const entry = { kind: "inline", js: "x", css: "" } as const;
    expect(
      computeViewVersion({ ...entry, viewConfig: { displayModes: ["inline"] } })
    ).toBe(computeViewVersion(entry));
  });

  it("hashes the view settings declared on the bound tool", () => {
    const entry = { kind: "inline", js: "x", css: "" } as const;
    const bundleOnly = computeViewVersion(entry);
    expect(bundleOnly).toBe("14f825b2");
    expect(computeViewVersion(entry, {})).toBe(bundleOnly);

    const withCsp = computeViewVersion(entry, {
      csp: { connectDomains: ["https://api.example.com"] },
    });
    expect(withCsp).toBe("75c05d50");
    expect(
      computeViewVersion(entry, {
        csp: { connectDomains: ["https://other.example.com"] },
      })
    ).toBe("bc758413");
    expect(computeViewVersion(entry, { prefersBorder: true })).toBe("91c8e77a");
    expect(
      computeViewVersion(entry, { domain: "https://app.example.com" })
    ).toBe("9d80c2f2");
    expect(computeViewVersion(entry, { permissions: { camera: {} } })).toBe(
      "ca5d279d"
    );
  });

  it("hashes the domain as the origin the host receives", () => {
    const entry = { kind: "inline", js: "x", css: "" } as const;
    const origin = computeViewVersion(entry, {
      domain: "https://app.example.com",
    });
    expect(origin).toBe("9d80c2f2");
    expect(
      computeViewVersion(entry, { domain: "https://app.example.com/a/b?c=1" })
    ).toBe(origin);
    expect(
      computeViewVersion(entry, { domain: "https://other.example.com" })
    ).not.toBe(origin);
  });

  it("gives equal settings the same version whatever their key order", () => {
    const entry = { kind: "inline", js: "x", css: "" } as const;
    expect(
      computeViewVersion(entry, {
        prefersBorder: true,
        csp: {
          resourceDomains: ["https://cdn.example.com"],
          connectDomains: ["https://api.example.com"],
        },
      })
    ).toBe(
      computeViewVersion(entry, {
        csp: {
          connectDomains: ["https://api.example.com"],
          resourceDomains: ["https://cdn.example.com"],
        },
        prefersBorder: true,
      })
    );
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
