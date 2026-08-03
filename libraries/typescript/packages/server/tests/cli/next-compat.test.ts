import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isNextProject,
  loadProjectEnv,
  nextStandaloneCompatPlugin,
} from "../../src/cli/next-compat.js";

const dirs: string[] = [];
const keys = ["MCP_USE_ENV_PRIORITY", "MCP_USE_SHELL_PRIORITY"] as const;

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  for (const key of keys) delete process.env[key];
});

function project(next = true): string {
  const cwd = mkdtempSync(join(tmpdir(), "mcp-use-next-compat-"));
  dirs.push(cwd);
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(next ? { dependencies: { next: "16.0.0" } } : {})
  );
  return cwd;
}

describe("standalone Next compatibility", () => {
  it("detects Next only from the selected project root", () => {
    expect(isNextProject(project())).toBe(true);
    expect(isNextProject(project(false))).toBe(false);
  });

  it("loads Next development env files in priority order without replacing shell values", () => {
    const cwd = project();
    writeFileSync(join(cwd, ".env"), "MCP_USE_ENV_PRIORITY=base\n");
    writeFileSync(
      join(cwd, ".env.development"),
      "MCP_USE_ENV_PRIORITY=development\n"
    );
    writeFileSync(
      join(cwd, ".env.local"),
      "MCP_USE_ENV_PRIORITY=local\nMCP_USE_SHELL_PRIORITY=file\n"
    );
    writeFileSync(
      join(cwd, ".env.development.local"),
      "MCP_USE_ENV_PRIORITY=development-local\n"
    );
    process.env.MCP_USE_SHELL_PRIORITY = "shell";

    loadProjectEnv(cwd, "development");

    expect(process.env.MCP_USE_ENV_PRIORITY).toBe("development-local");
    expect(process.env.MCP_USE_SHELL_PRIORITY).toBe("shell");
  });

  it("only resolves server-runtime shims for SSR imports", async () => {
    const plugin = nextStandaloneCompatPlugin(project());
    const resolveId = plugin.resolveId as unknown as (
      source: string,
      importer: string | undefined,
      options: { ssr: boolean }
    ) => unknown;
    expect(resolveId("server-only", undefined, { ssr: true })).toMatchObject({
      external: false,
    });
    expect(resolveId("server-only", undefined, { ssr: false })).toBeUndefined();
  });
});
