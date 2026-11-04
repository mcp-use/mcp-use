import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { nextStandaloneCompatPlugin } from "../../src/toolchain/next-compat.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
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
