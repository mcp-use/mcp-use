import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

describe("scaffolding GitHub repository templates", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "create-mcp-use-app-github-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each([
    ["mcp-use-test/template-repo", "template-repo"],
    ["mcp-use-test/template.repo", "template.repo"],
    ["mcp-use-test/template-repo.git", "template-repo"],
    ["mcp-use-test/template.repo.git", "template.repo"],
    [
      "mcp-use-test/template.repo.git#feature/template",
      "template.repo",
      "feature/template",
    ],
    ["github.com/mcp-use-test/template.repo.git", "template.repo"],
    ["https://github.com/mcp-use-test/template.repo", "template.repo"],
    ["https://github.com/mcp-use-test/template.repo.git", "template.repo"],
    [
      "https://github.com/mcp-use-test/template.repo.git#feature/template",
      "template.repo",
      "feature/template",
    ],
  ])("creates a project from %s", (template, repository, branch) => {
    const source = join(cwd, "template");
    const git = (args: string[]) => {
      const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(result.status, result.stderr).toBe(0);
    };
    git(["init", "--initial-branch=main", source]);
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({
        name: "template",
        dependencies: { "mcp-use": "{{mcp-use_version}}" },
      })
    );
    writeFileSync(
      join(source, "index.ts"),
      'export const serverName = "{{PROJECT_NAME}}";\n'
    );
    git(["-C", source, "add", "package.json", "index.ts"]);
    git([
      "-C",
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Add template",
    ]);

    if (branch) {
      git(["-C", source, "checkout", "-b", branch]);
      writeFileSync(join(source, "branch.txt"), branch);
      git(["-C", source, "add", "branch.txt"]);
      git([
        "-C",
        source,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "Add branch marker",
      ]);
    }

    // Replace only the GitHub boundary; the CLI still invokes real Git.
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "my-project",
        "--template",
        template,
        "--dev",
        "--no-install",
        "--no-skills",
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: `url.${pathToFileURL(source).href}.insteadOf`,
          GIT_CONFIG_VALUE_0: `https://github.com/mcp-use-test/${repository}.git`,
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(join(cwd, "my-project", "package.json"), "utf8"))
    ).toMatchObject({
      name: "my-project",
      dependencies: { "mcp-use": "workspace:*" },
    });
    expect(
      readFileSync(join(cwd, "my-project", "index.ts"), "utf8").trim()
    ).toBe('export const serverName = "my-project";');
    if (branch) {
      expect(readFileSync(join(cwd, "my-project", "branch.txt"), "utf8")).toBe(
        branch
      );
    }
  });
});
