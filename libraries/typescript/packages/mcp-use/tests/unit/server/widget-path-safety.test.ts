import { describe, expect, it } from "vitest";
import {
  pathHelpers,
  safeSegment,
  safeSubpath,
} from "../../../src/server/utils/runtime.js";

// Guards for the unauthenticated static widget/public routes. The runtime
// adapters normalize `..` in practice, but these guards are the real
// containment control for embeddings that don't (e.g. mounting under Express).

describe("safeSubpath", () => {
  it("rejects path traversal payloads", () => {
    const bad = [
      "../../etc/passwd",
      "..%2f..%2fetc/passwd", // encoded slash
      "%2e%2e/%2e%2e/etc/passwd", // encoded dots
      "%2e%2e%2f%2e%2e%2fetc/passwd", // fully encoded
      "/etc/passwd", // absolute
      "//etc/passwd", // UNC-ish absolute
      "a/../../b", // escapes after descending
      "a/..\\..\\b", // backslash separators
      "..\\..\\windows", // windows traversal
      "C:/Windows/win.ini", // drive-absolute
      "foo\0/etc/passwd", // NUL byte
      "./.", // dot segments only
    ];
    for (const input of bad) {
      expect(safeSubpath(input), input).toBeNull();
    }
  });

  it("accepts legitimate relative subpaths unchanged", () => {
    const ok = [
      "index.js",
      "assets/app.css",
      "sub/dir/file.png",
      "logo.svg",
      "a.b.c.min.js",
      "nested..name/file.js", // `..` only as part of a name, not a segment
    ];
    for (const input of ok) {
      expect(safeSubpath(input), input).toBe(input);
    }
  });
});

describe("safeSegment", () => {
  it("rejects separators, empties, and traversal", () => {
    for (const input of ["..", ".", "", "a/b", "a\\b", "..%2f", "/x", "x\0"]) {
      expect(safeSegment(input), input).toBeNull();
    }
  });

  it("accepts a single safe segment", () => {
    expect(safeSegment("kanban-board")).toBe("kanban-board");
    expect(safeSegment("Widget_123")).toBe("Widget_123");
  });
});

describe("pathHelpers.join (defense-in-depth normalization)", () => {
  it("joins and collapses redundant slashes", () => {
    expect(pathHelpers.join("/app", "dist/public", "a/b.css")).toBe(
      "/app/dist/public/a/b.css"
    );
    expect(pathHelpers.join("/app//dist", "public")).toBe("/app/dist/public");
  });

  it("collapses . and .. segments", () => {
    expect(pathHelpers.join("/app", "./dist", "./public")).toBe(
      "/app/dist/public"
    );
    expect(pathHelpers.join("/app/dist/public", "../../x")).toBe("/app/x");
  });
});
