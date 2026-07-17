import { describe, expect, it } from "vitest";

import {
  DEFAULT_INSPECTOR_ASSETS_URL,
  isDefaultJsdelivrInspectorUrl,
  withInspectorCacheBust,
} from "../src/inspector-shell.js";

describe("withInspectorCacheBust", () => {
  it("recognizes the default jsDelivr inspector URL", () => {
    expect(isDefaultJsdelivrInspectorUrl(DEFAULT_INSPECTOR_ASSETS_URL)).toBe(
      true
    );
    expect(
      isDefaultJsdelivrInspectorUrl("https://intranet.example.com/inspector.js")
    ).toBe(false);
  });

  it("appends cb to the default jsDelivr URL", () => {
    const busted = withInspectorCacheBust(DEFAULT_INSPECTOR_ASSETS_URL);
    expect(busted).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mcp-use\/inspector@beta\/dist\/cdn\/inspector\.js\?cb=[0-9a-f-]{36}$/
    );
  });

  it("leaves custom asset URLs unchanged", () => {
    const custom = "http://127.0.0.1:4173/inspector.js";
    expect(withInspectorCacheBust(custom)).toBe(custom);
  });

  it("uses & when the URL already has a query string", () => {
    const withQuery = `${DEFAULT_INSPECTOR_ASSETS_URL}?foo=bar`;
    const busted = withInspectorCacheBust(withQuery);
    expect(busted).toMatch(/\?foo=bar&cb=[0-9a-f-]{36}$/);
  });

  it("generates a new cb value on each call", () => {
    const a = withInspectorCacheBust(DEFAULT_INSPECTOR_ASSETS_URL);
    const b = withInspectorCacheBust(DEFAULT_INSPECTOR_ASSETS_URL);
    expect(a).not.toBe(b);
  });
});
