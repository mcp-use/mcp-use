import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverViews,
  isViewEntryPath,
  isViewPath,
} from "../../src/cli/views.js";

describe("discoverViews", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "mcp-use-views-"));
    dirs.push(dir);
    return dir;
  }

  it("returns an empty list when views/ is missing", () => {
    expect(discoverViews(tempProject())).toEqual([]);
  });

  it("finds views/foo/view.tsx and ignores dirs without view.tsx", () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, "views", "foo"), { recursive: true });
    writeFileSync(
      join(cwd, "views", "foo", "view.tsx"),
      "export default () => null;"
    );
    mkdirSync(join(cwd, "views", "bar"), { recursive: true });

    expect(discoverViews(cwd)).toEqual([
      {
        name: "foo",
        entryPath: join(cwd, "views", "foo", "view.tsx"),
      },
    ]);
  });

  it("discovers legacy resources/<name>/widget.tsx entries", () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, "resources", "legacy"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "legacy", "widget.tsx"),
      "export default () => null;"
    );

    expect(discoverViews(cwd)).toEqual([
      {
        name: "legacy",
        entryPath: join(cwd, "resources", "legacy", "widget.tsx"),
        legacy: true,
      },
    ]);
  });

  it("discovers an explicit views directory relative to the project root", () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, "src", "mcp", "views", "card"), {
      recursive: true,
    });
    const entryPath = join(cwd, "src", "mcp", "views", "card", "view.tsx");
    writeFileSync(entryPath, "export default () => null;");

    expect(discoverViews(cwd, "src/mcp/views")).toEqual([
      { name: "card", entryPath },
    ]);
  });
});

describe("isViewPath", () => {
  it("matches paths under views/<name>/", () => {
    const cwd = "/project";
    expect(isViewPath("/project/views/demo/view.tsx", cwd)).toBe(true);
    expect(isViewPath("/project/views/demo/components/Card.tsx", cwd)).toBe(
      true
    );
    expect(isViewPath("/project/resources/demo/widget.tsx", cwd)).toBe(true);
  });

  it("matches paths under a custom views directory", () => {
    expect(
      isViewPath(
        "/project/src/mcp/views/demo/view.tsx",
        "/project",
        "src/mcp/views"
      )
    ).toBe(true);
    expect(
      isViewPath("/project/views/demo/view.tsx", "/project", "src/mcp/views")
    ).toBe(false);
  });
});

describe("isViewEntryPath", () => {
  it("matches only views/<name>/view.tsx", () => {
    const cwd = "/project";
    expect(isViewEntryPath("/project/views/demo/view.tsx", cwd)).toBe(true);
    expect(isViewEntryPath("/project/views/demo/index.tsx", cwd)).toBe(false);
    expect(isViewEntryPath("/project/resources/demo/view.tsx", cwd)).toBe(
      false
    );
    expect(isViewEntryPath("/project/resources/demo/widget.tsx", cwd)).toBe(
      true
    );
  });

  it("matches entries under a custom views directory", () => {
    expect(
      isViewEntryPath(
        "/project/src/mcp/views/demo/view.tsx",
        "/project",
        "src/mcp/views"
      )
    ).toBe(true);
  });
});
