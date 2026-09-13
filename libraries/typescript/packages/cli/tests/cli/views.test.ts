import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { emptyTest as it } from "./fixtures.js";

import {
  discoverViews,
  isViewEntryPath,
  isViewPath,
} from "../../src/cli/views.js";

describe("discoverViews", () => {
  it("returns an empty list when views/ is missing", ({ project }) => {
    expect(discoverViews(project.cwd)).toEqual([]);
  });

  it("finds views/foo/view.tsx and ignores dirs without view.tsx", ({
    project,
  }) => {
    const cwd = project.cwd;
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

  it("does not discover legacy resources/ paths", ({ project }) => {
    const cwd = project.cwd;
    mkdirSync(join(cwd, "resources", "legacy"), { recursive: true });
    writeFileSync(
      join(cwd, "resources", "legacy", "view.tsx"),
      "export default () => null;"
    );

    expect(discoverViews(cwd)).toEqual([]);
  });

  it("discovers an explicit views directory relative to the project root", ({
    project,
  }) => {
    const cwd = project.cwd;
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
    expect(isViewPath("/project/resources/demo/view.tsx", cwd)).toBe(false);
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
