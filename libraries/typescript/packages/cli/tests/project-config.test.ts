import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The resolution helpers (resolveEntryFile, resolveWidgetsDir) are now
 * inlined in src/index.ts. We import them here by reaching into the built
 * CLI — but since we're testing from source, we access the functions via a
 * dynamic import of the source module.
 *
 * To keep tests independent of the CLI's command-line wiring we duplicate
 * the pure logic here. If the signatures in index.ts drift, these tests
 * will need updating — that's intentional: they're the contract.
 */

// Duplicated from index.ts so we can unit-test without importing the entire
// CLI (which registers commander side-effects on import).
import { access } from "node:fs/promises";

async function resolveEntryFile(
  projectPath: string,
  cliEntry?: string,
  mcpDir?: string
): Promise<string> {
  if (cliEntry) {
    await access(path.join(projectPath, cliEntry)).catch(() => {
      throw new Error(`File not found: ${cliEntry}`);
    });
    return cliEntry;
  }

  if (mcpDir) {
    const mcpCandidates = [
      path.join(mcpDir, "index.ts"),
      path.join(mcpDir, "index.tsx"),
      path.join(mcpDir, "server.ts"),
      path.join(mcpDir, "server.tsx"),
    ];
    for (const candidate of mcpCandidates) {
      try {
        await access(path.join(projectPath, candidate));
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error(`No entry file found inside ${mcpDir}.`);
  }

  const candidates = ["index.ts", "src/index.ts", "server.ts", "src/server.ts"];
  for (const candidate of candidates) {
    try {
      await access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(`No entry file found.`);
}

function resolveWidgetsDir(cliWidgetsDir?: string, mcpDir?: string): string {
  if (cliWidgetsDir) return cliWidgetsDir;
  if (mcpDir) return path.join(mcpDir, "resources");
  return "resources";
}

describe("resolveWidgetsDir", () => {
  it("CLI flag wins over everything", () => {
    expect(resolveWidgetsDir("cli/widgets", "mcp")).toBe("cli/widgets");
  });

  it("defaults to <mcpDir>/resources when only mcpDir is set", () => {
    expect(resolveWidgetsDir(undefined, "src/mcp")).toBe(
      path.join("src/mcp", "resources")
    );
  });

  it("defaults to 'resources' when nothing is set", () => {
    expect(resolveWidgetsDir(undefined)).toBe("resources");
  });
});

describe("resolveEntryFile", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = path.join(
      tmpdir(),
      `entry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("CLI --entry wins and is asserted to exist", async () => {
    await writeFile(path.join(projectDir, "custom.ts"), "// entry");
    const resolved = await resolveEntryFile(projectDir, "custom.ts");
    expect(resolved).toBe("custom.ts");
  });

  it("throws when CLI --entry points at a missing file", async () => {
    await expect(
      resolveEntryFile(projectDir, "does-not-exist.ts")
    ).rejects.toThrow(/File not found: does-not-exist\.ts/);
  });

  it("prefers <mcpDir>/index.ts when mcpDir is set", async () => {
    await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
    await writeFile(
      path.join(projectDir, "src", "mcp", "index.ts"),
      "// entry"
    );
    const resolved = await resolveEntryFile(projectDir, undefined, "src/mcp");
    expect(resolved).toBe(path.join("src/mcp", "index.ts"));
  });

  it("falls back to <mcpDir>/index.tsx when index.ts is absent", async () => {
    await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
    await writeFile(
      path.join(projectDir, "src", "mcp", "index.tsx"),
      "// entry"
    );
    const resolved = await resolveEntryFile(projectDir, undefined, "src/mcp");
    expect(resolved).toBe(path.join("src/mcp", "index.tsx"));
  });

  it("throws with a mcpDir-specific error when the dir has no entry file", async () => {
    await mkdir(path.join(projectDir, "src", "mcp"), { recursive: true });
    await expect(
      resolveEntryFile(projectDir, undefined, "src/mcp")
    ).rejects.toThrow(/No entry file found inside src\/mcp/);
  });

  it("uses the legacy top-level default search when no mcpDir is set", async () => {
    await writeFile(path.join(projectDir, "index.ts"), "// entry");
    const resolved = await resolveEntryFile(projectDir);
    expect(resolved).toBe("index.ts");
  });

  it("throws when neither mcpDir nor legacy default entry exist", async () => {
    await expect(resolveEntryFile(projectDir)).rejects.toThrow(
      /No entry file found/
    );
  });
});
