import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Exercise the shipped command; run `pnpm build` before this suite.
const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

describe("CLI arguments", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "create-mcp-use-app-args-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function runCli(args: string[]) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
  }

  it.each([
    [["--templat", "mcp-apps"], "ERR_PARSE_ARGS_UNKNOWN_OPTION"],
    [["--yarn"], "ERR_PARSE_ARGS_UNKNOWN_OPTION"],
    [["other-project"], "Unexpected extra argument: other-project"],
  ])("rejects invalid arguments %j before creating files", (args, error) => {
    const result = runCli([
      "my-project",
      ...args,
      "--sdk-version",
      "1.0.0",
      "--no-install",
      "--no-skills",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain(error);
    expect(result.status).toBe(1);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it.each(["--template", "-t"])(
    "scaffolds the requested template with %s and the documented negative flags",
    (templateFlag) => {
      const result = runCli([
        "my-project",
        templateFlag,
        "mcp-apps",
        "--sdk-version",
        "1.0.0",
        "--no-install",
        "--no-skills",
      ]);

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const project = join(cwd, "my-project");
      const pkg = JSON.parse(
        readFileSync(join(project, "package.json"), "utf8")
      );
      expect(pkg.name).toBe("my-project");
      expect(pkg.dependencies["mcp-use"]).toBe("1.0.0");
      const entries = readdirSync(project);
      expect(entries).toContain("views");
      expect(entries).not.toContain("node_modules");
      expect(entries).not.toContain(".agents");
      expect(entries).not.toContain(".claude");
    }
  );
});
