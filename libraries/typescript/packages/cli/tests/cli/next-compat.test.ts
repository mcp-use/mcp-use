import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect } from "vitest";
import { it } from "./fixtures.js";
import type { TestProjects } from "./project.js";

import {
  isNextProject,
  loadProjectEnv,
  nextStandaloneCompatPlugin,
} from "../../src/cli/next-compat.js";

const keys = ["MCP_USE_ENV_PRIORITY", "MCP_USE_SHELL_PRIORITY"] as const;

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

function nextProject(projects: TestProjects, next = true): string {
  const { cwd } = projects.create("empty");
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(next ? { dependencies: { next: "16.0.0" } } : {})
  );
  return cwd;
}

describe("standalone Next compatibility", () => {
  it("detects Next only from the selected project root", ({ projects }) => {
    expect(isNextProject(nextProject(projects))).toBe(true);
    expect(isNextProject(nextProject(projects, false))).toBe(false);
  });

  it("loads Next development env files in priority order without replacing shell values", ({
    projects,
  }) => {
    const cwd = nextProject(projects);
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

  it("only resolves server-runtime shims for SSR imports", async ({
    projects,
  }) => {
    const plugin = nextStandaloneCompatPlugin(nextProject(projects));
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
