import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect } from "vitest";

import { runTypecheck } from "../../src/toolchain/typecheck.js";
import { test as it } from "../helpers/cli-test.js";
import { copyFixture, removeDir } from "./helpers.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

/** Minimal strict tsconfig for a scratch fixture. */
function writeTsconfig(cwd: string, include: string[]): void {
  writeFileSync(
    join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
      },
      include,
    })
  );
}

describe("runTypecheck", () => {
  it("creates mcp-env.d.ts before tsc checks unexported tool refs", async () => {
    const cwd = copyFixture("typecheck");
    dirs.push(cwd);
    writeFileSync(
      join(cwd, "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    writeFileSync(
      join(cwd, "view.ts"),
      [
        'import { useCallTool } from "mcp-use/react";',
        'import logoUrl from "./logo.svg";',
        "const typedLogoUrl: string = logoUrl;",
        "void typedLogoUrl;",
        "// @ts-expect-error add is registered but its ToolRef is not exported",
        'useCallTool("add");',
      ].join("\n")
    );
    writeTsconfig(cwd, ["src/**/*", "view.ts", "mcp-env.d.ts"]);

    await expect(
      runTypecheck({ cwd, tscArgs: ["--pretty", "false"] })
    ).resolves.toBe(0);
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'tools: typeof import("./src/index.js")'
    );
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'import "mcp-use/vite-client"'
    );
  });

  it("reports success on stdout when the project is clean", async ({ cli }) => {
    const cwd = copyFixture("typecheck-clean");
    dirs.push(cwd);
    writeTsconfig(cwd, ["src/**/*", "mcp-env.d.ts"]);

    const result = await cli.run(["typecheck", "--", "--pretty", "false"], {
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\[mcp-use\] no type errors \(\d+ms\)$/m);
  });

  it("prints tsc errors and no success line when the project has type errors", async ({
    cli,
  }) => {
    const cwd = copyFixture("typecheck-errors");
    dirs.push(cwd);
    writeFileSync(join(cwd, "bad.ts"), "export const port: number = 'nope';\n");
    writeTsconfig(cwd, ["src/**/*", "bad.ts", "mcp-env.d.ts"]);

    const result = await cli.run(["typecheck", "--", "--pretty", "false"], {
      cwd,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("bad.ts(1,14): error TS2322");
    expect(result.stdout).not.toContain("no type errors");
  });
});
