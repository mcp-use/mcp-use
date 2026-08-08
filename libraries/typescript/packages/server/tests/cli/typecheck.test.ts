import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { runTypecheck } from "../../src/cli/typecheck.js";
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

  it("reports success on stdout when the project is clean", async () => {
    const cwd = copyFixture("typecheck-clean");
    dirs.push(cwd);
    writeTsconfig(cwd, ["src/**/*", "mcp-env.d.ts"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        runTypecheck({ cwd, tscArgs: ["--pretty", "false"] })
      ).resolves.toBe(0);
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines).toContainEqual(
        expect.stringMatching(/^\[mcp-use] no type errors \(\d+ms\)$/)
      );
    } finally {
      log.mockRestore();
    }
  });

  it("stays silent about success when tsc reports errors", async () => {
    const cwd = copyFixture("typecheck-errors");
    dirs.push(cwd);
    writeFileSync(join(cwd, "bad.ts"), "export const port: number = 'nope';\n");
    writeTsconfig(cwd, ["src/**/*", "bad.ts", "mcp-env.d.ts"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await runTypecheck({
        cwd,
        tscArgs: ["--pretty", "false"],
      });
      expect(exitCode).not.toBe(0);
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines).not.toContainEqual(
        expect.stringContaining("no type errors")
      );
    } finally {
      log.mockRestore();
    }
  });
});
