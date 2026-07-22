import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runTypecheck } from "../../src/cli/typecheck.js";
import { copyFixture, removeDir } from "./helpers.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe("runTypecheck", () => {
  it("creates mcp-env.d.ts before tsc checks unexported tool refs", async () => {
    const cwd = copyFixture("typecheck");
    dirs.push(cwd);
    writeFileSync(
      join(cwd, "view.ts"),
      [
        'import { useCallTool } from "mcp-use/react";',
        "// @ts-expect-error add is registered but its ToolRef is not exported",
        'useCallTool("add");',
      ].join("\n")
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src/**/*", "view.ts", "mcp-env.d.ts"],
      })
    );

    await expect(
      runTypecheck({ cwd, tscArgs: ["--pretty", "false"] })
    ).resolves.toBe(0);
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'tools: typeof import("./src/index.js")'
    );
  });
});
