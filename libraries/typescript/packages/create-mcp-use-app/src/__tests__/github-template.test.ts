import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getTemplateCloneArgs } from "../github-template.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(args: string[], cwd?: string) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
}

function createRepository(defaultBranch: string) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-template-"));
  directories.push(directory);
  const repo = join(directory, "source");
  expect(git(["init", "--initial-branch", defaultBranch, repo]).status).toBe(0);
  writeFileSync(join(repo, "branch.txt"), defaultBranch);
  expect(git(["add", "branch.txt"], repo).status).toBe(0);
  expect(
    git(
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "template",
      ],
      repo
    ).status
  ).toBe(0);
  return { directory, repo, url: pathToFileURL(repo).href };
}

describe("GitHub template clone branch selection", () => {
  it.each(["develop", "main", "master"])(
    "uses the remote default branch %s when no branch is supplied",
    (defaultBranch) => {
      const { directory, url } = createRepository(defaultBranch);
      const target = join(directory, "target");
      const args = getTemplateCloneArgs(url, target);
      const result = git(args);
      expect(result.stderr).not.toContain("Remote branch main not found");
      expect(result.status).toBe(0);
      expect(readFileSync(join(target, "branch.txt"), "utf8")).toBe(
        defaultBranch
      );
      expect(
        git(["rev-parse", "--is-shallow-repository"], target).stdout.trim()
      ).toBe("true");
    }
  );

  it("clones the explicitly requested branch rather than the default", () => {
    const { directory, repo, url } = createRepository("develop");
    expect(git(["checkout", "-b", "feature/template"], repo).status).toBe(0);
    writeFileSync(join(repo, "branch.txt"), "feature/template");
    expect(git(["add", "branch.txt"], repo).status).toBe(0);
    expect(
      git(
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "feature",
        ],
        repo
      ).status
    ).toBe(0);
    expect(git(["checkout", "develop"], repo).status).toBe(0);
    const target = join(directory, "target");
    expect(
      git(getTemplateCloneArgs(url, target, "feature/template")).status
    ).toBe(0);
    expect(readFileSync(join(target, "branch.txt"), "utf8")).toBe(
      "feature/template"
    );
  });

  it("does not fall back to the default when an explicit branch is missing", () => {
    const { directory, url } = createRepository("develop");
    const result = git(
      getTemplateCloneArgs(url, join(directory, "target"), "missing")
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Remote branch missing not found");
  });
});
