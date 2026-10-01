import { describe, expect, it } from "vitest";

import {
  browserCandidates,
  normalizeCaptureBounds,
  parseDimension,
  readyStateFailure,
} from "../../src/commands/screenshot.js";

describe("screenshot dimensions", () => {
  it.each([
    ["1", 1],
    ["768", 768],
    ["10000000", 10_000_000],
  ])("accepts %s pixels", (value, expected) => {
    expect(parseDimension(value, "--width")).toBe(expected);
  });

  it.each(["0", "767.5", "10000001", "not-a-number"])(
    "rejects %s pixels before capture",
    (value) => {
      expect(() => parseDimension(value, "--width")).toThrow(
        "--width must be an integer from 1 to 10000000."
      );
    }
  );
});

describe("screenshot capture bounds", () => {
  it("pixel-aligns the rendered widget instead of retaining viewport space", () => {
    expect(
      normalizeCaptureBounds({
        x: 0.25,
        y: 1.5,
        width: 767.5,
        height: 508.25,
      })
    ).toEqual({
      x: 0,
      y: 1,
      width: 768,
      height: 509,
    });
  });

  it.each([
    null,
    {},
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: Number.NaN },
  ])("rejects invalid rendered bounds: %j", (bounds) => {
    expect(() => normalizeCaptureBounds(bounds)).toThrow(
      /widget bounds|invalid widget bounds/
    );
  });
});

describe("screenshot readiness gate", () => {
  it("has no failure while the view is still resolving", () => {
    expect(readyStateFailure(undefined)).toBeUndefined();
    expect(readyStateFailure({})).toBeUndefined();
    expect(readyStateFailure({ ready: false, selector: true })).toBeUndefined();
  });

  it("has no failure once the view becomes ready", () => {
    expect(readyStateFailure({ ready: true, selector: true })).toBeUndefined();
  });

  it("fails only on an explicit initialization failure", () => {
    const failure = readyStateFailure({
      error: "view_load_failed",
      errorMessage: "Sandbox did not report ready.",
    });
    expect(failure?.code).toBe("view_load_failed");
    expect(failure?.message).toContain("Sandbox did not report ready.");
  });

  it("falls back to a generic message when no detail is available", () => {
    const failure = readyStateFailure({ error: "view_load_failed" });
    expect(failure?.code).toBe("view_load_failed");
    expect(failure?.message).toBe("MCP App failed to initialize.");
  });

  it("never fails on a widget's own runtime error after it has initialized", () => {
    // A widget's console.error / uncaught error / unhandled rejection must
    // not surface here — only the Inspector's explicit "view_load_failed"
    // initialization-failure signal does. Any other value (including a
    // widget-authored error string) is ignored.
    expect(
      readyStateFailure({
        ready: true,
        selector: true,
        error: "runtime_error",
      })
    ).toBeUndefined();
  });
});

describe("screenshot browser discovery", () => {
  const windowsEnv = {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
  };

  it("falls back to the Edge that ships with Windows after Chrome", () => {
    const candidates = browserCandidates("win32", windowsEnv);
    const chrome = candidates.indexOf(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    );
    const edge = candidates.indexOf(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    );

    expect(chrome).toBe(0);
    expect(edge).toBeGreaterThan(chrome);
    expect(candidates).toContain(
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    );
  });

  it("tries a configured executable first", () => {
    expect(
      browserCandidates("win32", {
        ...windowsEnv,
        MCP_USE_CHROME_PATH: "D:\\browsers\\chrome.exe",
      })[0]
    ).toBe("D:\\browsers\\chrome.exe");
  });

  it("skips Windows locations whose environment variable is unset", () => {
    expect(browserCandidates("win32", {})).toEqual([]);
  });
});
