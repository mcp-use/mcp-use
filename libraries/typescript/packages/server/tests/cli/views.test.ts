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

  it("does not discover legacy resources/ paths", () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, "resources", "legacy"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "legacy", "view.tsx"),
      "export default () => null;"
    );

    expect(discoverViews(cwd)).toEqual([]);
  });
});

describe("isViewPath", () => {
  it("matches paths under views/<name>/", () => {
    const cwd = "/project";
    expect(isViewPath("/project/views/demo/view.tsx", cwd)).toBe(true);
    expect(isViewPath("/project/views/demo/components/Card.tsx", cwd)).toBe(
      true
    );
    expect(isViewPath("/project/resources/demo/view.tsx", cwd)).toBe(false);
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
  });
});
